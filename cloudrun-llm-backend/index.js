/**
 * ETAP 4.1 - Cloud Run Backend dla Gmail CRM Extension
 * 
 * Gemini 2.5 Pro + Firestore + Secret Manager
 * Project: gmail-crm-extension-479113
 */

import express from "express";
// SecretManagerServiceClient removed - VertexAI uses ADC, not API keys
import { Firestore } from "@google-cloud/firestore";
import { VertexAI } from "@google-cloud/vertexai";

const app = express();
app.use(express.json({ limit: "15mb" }));

// ========== Configuration ==========
const PROJECT_ID = "gmail-crm-extension-479113";
const LOCATION = "us-central1";
const GEMINI_MODEL = "gemini-2.5-pro"; // Enterprise-grade model

// ========== Secret Manager (kept for future use) ==========
// Note: VertexAI uses Application Default Credentials (ADC), not API keys
// const secretClient = new SecretManagerServiceClient();

// ========== Firestore ==========
const db = new Firestore({
  projectId: PROJECT_ID,
});

// ========== Vertex AI (Gemini) ==========
let model = null;
let geminiReady = false;

async function initGemini() {
  try {
    console.log("🔧 Initializing Gemini 2.5 Pro (Enterprise) via Vertex AI...");
    console.log(`📍 Project: ${PROJECT_ID}, Location: ${LOCATION}`);
    
    // VertexAI uses Application Default Credentials (ADC) automatically
    // No API key needed - Cloud Run service account provides auth
    const vertex = new VertexAI({
      project: PROJECT_ID,
      location: LOCATION,
    });

    model = vertex.getGenerativeModel({
      model: GEMINI_MODEL,
      generationConfig: {
        temperature: 0.1, // Low temperature for consistent JSON output
        maxOutputTokens: 8192,
        topP: 0.95,
      },
    });
    
    geminiReady = true;
    console.log("✅ Gemini initialized successfully (using ADC)");
  } catch (error) {
    console.error("❌ Failed to initialize Gemini:", error);
    console.error("⚠️ Server will start but /analyze endpoint will not work");
    geminiReady = false;
  }
}

// Initialize Gemini asynchronously (don't block server startup)
initGemini().catch(err => {
  console.error("❌ Gemini initialization failed during startup:", err);
});

// ========== Prompt Template ==========
function buildPrompt(emailContent) {
  return `Przetwórz surowy e-mail (HTML, tekst, MIME, forwarded, quoted) i zwróć wyłącznie jeden obiekt JSON w określonym formacie.
Bez markdown, bez komentarzy, bez wyjaśnień, bez tekstu przed ani po JSON.

1. Cel zadania

Wyodrębnij z treści e-maila wszystkie dane B2B:
- organizacje (firmy, instytucje, urzędy, szpitale, uczelnie),
- osoby (kontakty biznesowe) powiązane z tym e-mailem.

Ignoruj:
- stopki prywatne,
- reklamy,
- social media,
- automatyczne podpisy,
- dane osobiste niezwiązane z biznesem.

2. Format odpowiedzi (ZWROT TYLKO TEGO JEDNEGO JSON):

{
  "companies": [...],
  "contacts": [...]
}

3. companies[] – definicja firmy

Każdy obiekt ma format:

{
  "company_name": "...",
  "company_friendly_name": "...",
  "website": "...",
  "phone": "...",
  "email": "...",
  "nip": "..."
}

Zasady dla firm:
- company_name = pełna oficjalna nazwa organizacji.
- company_friendly_name = nazwa marki/produktu lub wersja potoczna.
- website = główna domena firmowa (np. „firma.pl"), jeśli brak → null.
- phone = jeden główny numer firmowy, nie osobisty; jeśli brak → null.
- email = jeden główny adres firmowy typu info@ / office@ / contact@; jeśli brak → null.
- nip = dane rejestrowe firmy, jeśli występują (NIP/VAT/Tax ID).

Nie wstawiaj prywatnych maili/telefonów jako dane firmy.
Nie twórz firmy, jeśli nie ma wystarczających danych (chociaż nazwa lub domena).

4. contacts[] – definicja osoby

Każdy obiekt:

{
  "first_name": "...",
  "last_name": "...",
  "role": "...",
  "phone": "...",
  "mobile": "...",
  "email": "...",
  "company_name": "...",
  "salutation": "Pan" / "Pani" / null
}

Zasady dla kontaktów:
- first_name i last_name rozpoznaj ostrożnie z podpisów i treści.
- role = stanowisko lub funkcja.
- phone = jeden numer służbowy (nie komórkowy).
- mobile = jeden numer komórkowy.
- email = jeden najlepszy zawodowy adres osoby.
- company_name = powiąż z firmą tylko, jeśli to oczywiste.
- salutation = Pan/Pani jeśli pewne; inaczej null.

Jedna osoba = jeden obiekt.

5. Reguły ogólne

- Nie zgaduj danych — jeśli brak → null.
- Usuń stopki, disclaimery, social media, slogany, pouczenia prawne.
- Nie zwracaj niczego poza JSON-em.

6. Format końcowy: zwróć dokładnie ten JSON i nic poza nim

{
  "companies": [...],
  "contacts": [...]
}

EMAIL_CONTENT:
${emailContent}
`;
}

// ========== API Endpoint ==========
app.post("/analyze", async (req, res) => {
  const startTime = Date.now();
  
  try {
    // Check if Gemini is ready
    if (!geminiReady || !model) {
      console.error("❌ Gemini not initialized");
      return res.status(503).json({ 
        success: false,
        error: "Gemini service not ready. Please check server logs and Secret Manager access." 
      });
    }

    const { messageId, threadId, fullRawEmail } = req.body;
    
    // Validation
    if (!messageId || !fullRawEmail) {
      console.error("❌ Missing required fields");
      return res.status(400).json({ 
        success: false,
        error: "Missing messageId or fullRawEmail" 
      });
    }

    console.log(`🤖 Analyzing messageId: ${messageId}`);
    
    // Sprawdź czy analiza już istnieje w Firestore (cache)
    try {
      const existingDoc = await db.collection("messages").doc(messageId).get();
      if (existingDoc.exists) {
        const existingData = existingDoc.data();
        console.log(`✅ Found existing analysis for ${messageId}, returning cached result`);
        return res.json({
          success: true,
          messageId,
          analysis: existingData.analysis,
          metadata: {
            geminiModel: existingData.geminiModel || GEMINI_MODEL,
            processingTimeMs: Date.now() - startTime,
            cached: true,
            originalAnalyzedAt: existingData.analyzedAt,
            companiesCount: existingData.analysis?.companies?.length || 0,
            contactsCount: existingData.analysis?.contacts?.length || 0,
          }
        });
      }
    } catch (firestoreCheckError) {
      console.warn("⚠️ Firestore check failed (continuing with new analysis):", firestoreCheckError);
      // Kontynuuj z nową analizą jeśli sprawdzenie się nie powiodło
    }
    
    // Build prompt
    const prompt = buildPrompt(fullRawEmail);
    
    // Call Gemini
    const geminiStart = Date.now();
    const result = await model.generateContent({
      contents: [
        {
          role: "user",
          parts: [{ text: prompt }],
        },
      ],
    });
    const geminiTime = Date.now() - geminiStart;

    const responseText = result.response.candidates[0].content.parts[0].text.trim();
    console.log(`⏱️ Gemini response time: ${geminiTime}ms`);
    
    // Parse JSON
    let analysis;
    try {
      // Remove markdown code blocks if present
      const cleanText = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      analysis = JSON.parse(cleanText);
    } catch (e) {
      console.error("❌ Invalid JSON from Gemini:", e);
      console.error("Raw response:", responseText);
      return res.status(500).json({ 
        success: false,
        error: "Invalid JSON from Gemini", 
        raw: responseText 
      });
    }

    // Validate structure
    if (!analysis.companies || !analysis.contacts) {
      console.error("❌ Invalid analysis structure");
      return res.status(500).json({ 
        success: false,
        error: "Invalid analysis structure (missing companies or contacts)" 
      });
    }

    // Save to Firestore (best-effort - ewentualny błąd nie blokuje odpowiedzi LLM)
    let firestoreTime = null;
    let firestoreError = null;
    try {
      const firestoreStart = Date.now();
      await db.collection("messages").doc(messageId).set(
        {
          threadId,
          analysis,
          analyzedAt: Date.now(),
          geminiModel: GEMINI_MODEL,
          processingTimeMs: geminiTime,
        },
        { merge: true }
      );
      firestoreTime = Date.now() - firestoreStart;
    } catch (firestoreErr) {
      firestoreError = firestoreErr?.message || firestoreErr?.toString?.() || String(firestoreErr);
      console.error("❌ Firestore save failed (nie blokuję odpowiedzi):", firestoreErr);
    }
    
    const totalTime = Date.now() - startTime;
    
    console.log(`✅ Analysis complete for ${messageId}`);
    console.log(`   Companies: ${analysis.companies.length}, Contacts: ${analysis.contacts.length}`);
    console.log(`   Total time: ${totalTime}ms (Gemini: ${geminiTime}ms, Firestore: ${firestoreTime}ms)`);

    res.json({
      success: true,
      messageId,
      analysis,
      metadata: {
        geminiModel: GEMINI_MODEL,
        processingTimeMs: totalTime,
        geminiTimeMs: geminiTime,
        firestoreTimeMs: firestoreTime,
        firestoreError,
        companiesCount: analysis.companies.length,
        contactsCount: analysis.contacts.length,
      }
    });

  } catch (err) {
    console.error("❌ Error in Cloud Run /analyze:", err);
    res.status(500).json({ 
      success: false,
      error: err.toString() 
    });
  }
});

// ========== Check Cache Endpoint ==========
// Sprawdza czy analiza istnieje w Firestore bez potrzeby wysyłania emaila
app.post("/check-cache", async (req, res) => {
  const startTime = Date.now();
  
  try {
    const { messageId } = req.body;
    
    if (!messageId) {
      return res.status(400).json({ 
        success: false,
        error: "Missing messageId" 
      });
    }
    
    console.log(`🔍 Checking cache for messageId: ${messageId}`);
    
    const existingDoc = await db.collection("messages").doc(messageId).get();
    
    if (existingDoc.exists) {
      const existingData = existingDoc.data();
      console.log(`✅ Cache HIT for ${messageId}`);
      return res.json({
        success: true,
        cached: true,
        messageId,
        analysis: existingData.analysis,
        metadata: {
          geminiModel: existingData.geminiModel || GEMINI_MODEL,
          processingTimeMs: Date.now() - startTime,
          cached: true,
          originalAnalyzedAt: existingData.analyzedAt,
          companiesCount: existingData.analysis?.companies?.length || 0,
          contactsCount: existingData.analysis?.contacts?.length || 0,
        }
      });
    } else {
      console.log(`❌ Cache MISS for ${messageId}`);
      return res.json({
        success: true,
        cached: false,
        messageId,
        processingTimeMs: Date.now() - startTime
      });
    }
  } catch (err) {
    console.error("❌ Error in /check-cache:", err);
    res.status(500).json({ 
      success: false,
      error: err.toString() 
    });
  }
});

// ========== Health Check ==========
app.get("/health", (req, res) => {
  res.json({ 
    status: "ok", 
    service: "gmail-crm-llm-backend",
    model: GEMINI_MODEL,
    project: PROJECT_ID,
    geminiReady: geminiReady
  });
});

// ========== Start Server ==========
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`🚀 LLM backend running on port ${PORT}`);
  console.log(`📦 Project: ${PROJECT_ID}`);
  console.log(`🤖 Model: ${GEMINI_MODEL}`);
});

