# Deployment Instructions – Cloud Run + Gemini 2.5 Pro

## Project: `gmail-crm-extension-479113`

---

## 🎯 Cel

Wdrożenie backendu LLM (Gemini 2.5 Pro) na Cloud Run dla Gmail CRM Extension.

---

## ✅ Wymagania wstępne

1. **GCP Project**: `gmail-crm-extension-479113` (już istnieje)
2. **Secret Manager**: Klucz `GCP_API_GEMINI` (już utworzony)
3. **Firestore**: Database (utworzymy w kroku 2)
4. **Cloud Run**: Service (utworzymy w kroku 3)
5. **gcloud CLI**: Zainstalowany lokalnie lub użyj Cloud Shell

---

## 📋 Krok 1: Włącz wymagane API

### W Cloud Console:

https://console.cloud.google.com/apis/library

Włącz następujące API:
- ✅ **Cloud Run API**
- ✅ **Cloud Build API**
- ✅ **Secret Manager API** (już włączone)
- ✅ **Firestore API** (Firestore Native Mode)
- ✅ **Vertex AI API** (dla Gemini)

### Lub przez `gcloud`:

```bash
gcloud config set project gmail-crm-extension-479113

gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  secretmanager.googleapis.com \
  firestore.googleapis.com \
  aiplatform.googleapis.com
```

---

## 📋 Krok 2: Skonfiguruj Firestore

### W Cloud Console:

1. Idź do: https://console.cloud.google.com/firestore
2. Kliknij **"Create Database"**
3. Wybierz:
   - **Firestore Native Mode**
   - **Region**: `europe-west3` (Frankfurt) lub `us-central1` (Iowa)
4. **Kliknij "Create Database"**

### Lub przez `gcloud`:

```bash
gcloud firestore databases create \
  --location=europe-west3 \
  --type=firestore-native
```

**Uwaga:** Firestore można utworzyć tylko RAZ na projekt. Jeśli już istnieje, pomiń ten krok.

---

## 📋 Krok 3: Deploy Cloud Run

### 3.1. Otwórz Cloud Shell

Idź do: https://console.cloud.google.com/

Kliknij ikonę **">_"** (Cloud Shell) w prawym górnym rogu.

### 3.2. Sklonuj kod lub upload folderu

**Opcja A: Upload z lokalnego komputera**

W Cloud Shell kliknij **"⋮"** → **"Upload file"** → wybierz cały folder `cloudrun-llm-backend/`.

**Opcja B: Git (jeśli masz repo)**

```bash
git clone YOUR_REPO_URL
cd YOUR_REPO/cloudrun-llm-backend
```

### 3.3. Przejdź do folderu

```bash
cd cloudrun-llm-backend
ls -la  # Sprawdź czy masz: package.json, index.js, Dockerfile
```

### 3.4. Deploy na Cloud Run

```bash
gcloud run deploy gmail-crm-llm-backend \
  --source . \
  --region us-central1 \
  --platform managed \
  --allow-unauthenticated \
  --memory 1Gi \
  --cpu 1 \
  --timeout 60s \
  --max-instances 10 \
  --min-instances 0 \
  --set-env-vars "NODE_ENV=production"
```

**Parametry:**
- `--source .` – build z kodu źródłowego (automatyczny Dockerfile)
- `--region us-central1` – region (możesz zmienić na `europe-west1`)
- `--allow-unauthenticated` – dostęp bez autentykacji (na start, zabezpieczymy później)
- `--memory 1Gi` – 1 GB RAM (wystarczy dla Gemini)
- `--cpu 1` – 1 vCPU
- `--timeout 60s` – timeout 60 sekund (analiza LLM może trwać 5-30s)
- `--max-instances 10` – maksymalnie 10 instancji jednocześnie
- `--min-instances 0` – skalowanie do 0 gdy brak ruchu (oszczędność)

### 3.5. Zapisz URL Cloud Run

Po deployment zobaczysz:

```
Service [gmail-crm-llm-backend] revision [gmail-crm-llm-backend-00001-abc] has been deployed and is serving 100 percent of traffic.
Service URL: https://gmail-crm-llm-backend-XXXXXX-uc.a.run.app
```

**Skopiuj ten URL!** Będzie potrzebny w GAS.

---

## 📋 Krok 4: Nadaj uprawnienia Service Account

Cloud Run używa domyślnego Service Account:

```
PROJECT_NUMBER-compute@developer.gserviceaccount.com
```

### 4.1. Znajdź Project Number

```bash
gcloud projects describe gmail-crm-extension-479113 --format="value(projectNumber)"
```

Przykład: `123456789012`

### 4.2. Nadaj uprawnienia

```bash
# Podstaw swój PROJECT_NUMBER
PROJECT_NUMBER="123456789012"
SERVICE_ACCOUNT="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"

# Secret Manager (dostęp do GCP_API_GEMINI)
gcloud secrets add-iam-policy-binding GCP_API_GEMINI \
  --member="serviceAccount:${SERVICE_ACCOUNT}" \
  --role="roles/secretmanager.secretAccessor"

# Firestore (zapis i odczyt)
gcloud projects add-iam-policy-binding gmail-crm-extension-479113 \
  --member="serviceAccount:${SERVICE_ACCOUNT}" \
  --role="roles/datastore.user"

# Vertex AI (wywołanie Gemini)
gcloud projects add-iam-policy-binding gmail-crm-extension-479113 \
  --member="serviceAccount:${SERVICE_ACCOUNT}" \
  --role="roles/aiplatform.user"
```

**Sprawdź uprawnienia:**

```bash
gcloud projects get-iam-policy gmail-crm-extension-479113 \
  --flatten="bindings[].members" \
  --filter="bindings.members:${SERVICE_ACCOUNT}"
```

---

## 📋 Krok 5: Testuj Cloud Run

### 5.1. Health Check

```bash
curl https://gmail-crm-llm-backend-XXXXXX-uc.a.run.app/health
```

Powinno zwrócić:

```json
{
  "status": "ok",
  "service": "gmail-crm-llm-backend",
  "model": "gemini-2.0-flash-exp",
  "project": "gmail-crm-extension-479113"
}
```

### 5.2. Test analizy (Postman / curl)

**Przykładowy request:**

```bash
curl -X POST https://gmail-crm-llm-backend-XXXXXX-uc.a.run.app/analyze \
  -H "Content-Type: application/json" \
  -d '{
    "messageId": "test-123",
    "threadId": "test-thread-456",
    "fullRawEmail": "Subject: Testowa wiadomość\nFrom: jan.kowalski@example.com\n\nDzień dobry,\n\nNazywam się Jan Kowalski, Dyrektor Sprzedaży w Example Medical Sp. z o.o.\nKontakt: j.kowalski@exmed.pl, +48 600 123 456\nwww.exmed.pl\n\nPozdrawiam"
  }'
```

**Oczekiwana odpowiedź:**

```json
{
  "success": true,
  "messageId": "test-123",
  "analysis": {
    "companies": [
      {
        "company_name": "Example Medical Sp. z o.o.",
        ...
      }
    ],
    "contacts": [
      {
        "first_name": "Jan",
        "last_name": "Kowalski",
        ...
      }
    ]
  },
  "metadata": {
    "geminiModel": "gemini-2.0-flash-exp",
    "processingTimeMs": 2340,
    ...
  }
}
```

---

## 📋 Krok 6: Zaktualizuj GAS

### 6.1. Otwórz `G_APP_backend/Kod.js`

Znajdź linię:

```javascript
const CLOUD_RUN_URL = 'https://YOUR-CLOUD-RUN-URL/analyze';
```

### 6.2. Zastąp URL

```javascript
const CLOUD_RUN_URL = 'https://gmail-crm-llm-backend-XXXXXX-uc.a.run.app/analyze';
```

(podstaw swój rzeczywisty URL z kroku 3.5)

### 6.3. Deploy GAS

1. W Apps Script Editor kliknij **"Deploy"** → **"Manage deployments"**
2. Kliknij **"Edit"** przy aktywnym deployment
3. Kliknij **"Deploy"**

**Lub utwórz nowy deployment:**

Deploy → New deployment → Web app → Deploy

---

## 📋 Krok 7: Test end-to-end

### 7.1. W Chrome Extension

1. Otwórz Gmail
2. Otwórz dowolną wiadomość
3. Otwórz sidepanel (kliknij ikonę extension)
4. Kliknij **"🤖 Analizuj LLM"**
5. Sprawdź w konsoli sidepanelu:
   - `[Sidepanel] 🤖 CLICK na przycisk Analizuj LLM`
   - `[Background] 🤖 Analyze-message START`
   - `[Background] ✅ Analyze-message OK: XXXms`
6. Sprawdź w UI:
   - Sekcja "🤖 Analiza LLM" się rozwija
   - JSON z firmami i kontaktami jest wyświetlony
   - Ikonka ✓ przy messageId

### 7.2. Sprawdź logi Cloud Run

https://console.cloud.google.com/run/detail/us-central1/gmail-crm-llm-backend/logs

Powinny być wpisy:

```
🤖 Analyzing messageId: 19ab256bf212d825
⏱️ Gemini response time: 2340ms
✅ Analysis complete for 19ab256bf212d825
   Companies: 1, Contacts: 1
   Total time: 2580ms (Gemini: 2340ms, Firestore: 240ms)
```

### 7.3. Sprawdź Firestore

https://console.cloud.google.com/firestore/databases/-default-/data/panel/messages

Powinien być dokument z `messageId` jako ID.

---

## 📋 Krok 8: Monitorowanie i koszty

### 8.1. Cloud Run Metrics

https://console.cloud.google.com/run/detail/us-central1/gmail-crm-llm-backend/metrics

Monitoruj:
- **Request count** – ile analiz dziennie
- **Request latency** – średni czas odpowiedzi (powinno być <5s)
- **Container instance count** – ile instancji działa (powinno skalować do 0)
- **Billable container time** – czas fakturowania (Free Tier: 2M vCPU-seconds/month)

### 8.2. Firestore Metrics

https://console.cloud.google.com/firestore/usage

Monitoruj:
- **Reads/Writes** – ile operacji (Free Tier: 50k/20k dziennie)
- **Storage** – rozmiar bazy (Free Tier: 1 GB)

### 8.3. Vertex AI (Gemini) Metrics

https://console.cloud.google.com/vertex-ai/generative

Monitoruj:
- **API calls** – ile wywołań Gemini
- **Token usage** – ile tokenów zużyto (to kosztuje!)

**Koszty Gemini 2.5 Pro (używany w projekcie):**
- Input: $1.25 / 1M tokenów
- Output: $5.00 / 1M tokenów

**Przykład:** 
- 1000 analiz × ~2000 tokenów (średnio 1000 input + 1000 output)
- Input: 1M tokenów × $1.25 = $1.25
- Output: 1M tokenów × $5.00 = $5.00
- **Razem: ~$6.25/miesiąc** (dla 1000 analiz)

**Uwaga:** Gemini 2.5 Pro to model **Enterprise-grade**, droższy ale znacznie lepszy niż Gemini 2.0 Flash.

---

## 📋 Krok 9: Zabezpieczenie (opcjonalnie)

### Obecnie: `--allow-unauthenticated`
Każdy kto zna URL może wywołać endpoint.

### Zabezpieczenie (ETAP 5+):

1. **Usuń publiczny dostęp:**

```bash
gcloud run services remove-iam-policy-binding gmail-crm-llm-backend \
  --region=us-central1 \
  --member="allUsers" \
  --role="roles/run.invoker"
```

2. **Dodaj Service Account GAS:**

Znajdź Service Account używany przez Apps Script:
https://console.cloud.google.com/iam-admin/serviceaccounts

Powinien być:
```
PROJECT_ID@appspot.gserviceaccount.com
```

3. **Nadaj uprawnienia:**

```bash
gcloud run services add-iam-policy-binding gmail-crm-llm-backend \
  --region=us-central1 \
  --member="serviceAccount:gmail-crm-extension-479113@appspot.gserviceaccount.com" \
  --role="roles/run.invoker"
```

4. **Zaktualizuj GAS:**

W `analyzeMessage()` dodaj header:

```javascript
const options = {
  method: 'post',
  contentType: 'application/json',
  payload: JSON.stringify(payload),
  headers: {
    'Authorization': 'Bearer ' + ScriptApp.getOAuthToken()
  }
};
```

---

## 📋 Troubleshooting

### Problem: "Permission denied" w Cloud Run

**Rozwiązanie:** Sprawdź uprawnienia Service Account (Krok 4)

```bash
gcloud projects get-iam-policy gmail-crm-extension-479113 \
  --flatten="bindings[].members" \
  --filter="bindings.members:compute@developer.gserviceaccount.com"
```

### Problem: "Invalid JSON from Gemini"

**Rozwiązanie:** Gemini czasem zwraca markdown (```json). Kod w `index.js` już to obsługuje (`.replace(/```json/g, '')`).

Jeśli nadal problem, sprawdź logi Cloud Run i zobacz raw response.

### Problem: "Timeout" (60s)

**Rozwiązanie:** Zwiększ timeout:

```bash
gcloud run services update gmail-crm-llm-backend \
  --region=us-central1 \
  --timeout=120s
```

### Problem: "Out of memory"

**Rozwiązanie:** Zwiększ RAM:

```bash
gcloud run services update gmail-crm-llm-backend \
  --region=us-central1 \
  --memory=2Gi
```

---

## 📋 Update kodu (po zmianach)

Jeśli zmieniasz kod w `index.js`:

```bash
cd cloudrun-llm-backend

gcloud run deploy gmail-crm-llm-backend \
  --source . \
  --region us-central1
```

Cloud Run automatycznie:
- Zbuilduje nowy image
- Utworzy nową rewizję
- Przełączy ruch na nową wersję (blue-green deployment)

---

## 📋 Usunięcie serwisu (jeśli potrzeba)

```bash
gcloud run services delete gmail-crm-llm-backend \
  --region=us-central1
```

---

**Koniec instrukcji deployment** 🎉

