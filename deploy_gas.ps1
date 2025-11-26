# Ustaw kodowanie UTF-8 dla konsoli
$OutputEncoding = [System.Console]::OutputEncoding = [System.Text.Encoding]::UTF8

function gdeploy {
    Write-Host "🚀 Rozpoczynam wdrażanie Google Apps Script..." -ForegroundColor Cyan
    
    # Przejdź do katalogu backendu
    $backendPath = Join-Path $PSScriptRoot "G_APP_backend"
    Push-Location $backendPath
    
    try {
        Write-Host "📤 Clasp Push..." -ForegroundColor Yellow
        clasp push
        
        Write-Host "🏷️  Clasp Version..." -ForegroundColor Yellow
        clasp version "auto"
        
        Write-Host "🚀 Clasp Deploy..." -ForegroundColor Yellow
        clasp deploy -i "AKfycbx3O1NZWZZtRMVGXsMf-gi25GHbH-KnsLe9rPj-8HWr682Drs_Mk0z-cJjO0r5Q-AM"
        
        Write-Host "✅ Wdrożenie zakończone sukcesem!" -ForegroundColor Green
    }
    catch {
        Write-Error "❌ Wystąpił błąd podczas wdrażania: $_"
    }
    finally {
        # Wróć do katalogu głównego
        Pop-Location
    }
}

# Uruchom funkcję
gdeploy

