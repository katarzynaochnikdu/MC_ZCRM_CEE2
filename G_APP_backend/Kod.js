// Google Apps Script - Backend dla ZCRM CCE2 (ETAP 1 + ETAP 2)
// System logowania do Google Drive + Gmail API fetch

// NAZWA FOLDERU NA DRIVE (możesz zmienić)
const LOG_FOLDER_NAME = 'ZCRM_CCE2_Logs';
const ZOHO_CRM_API_VERSION = 'v8'; // używamy nowszej wersji API Zoho CRM (v8)

// ========== ETAP B: Zoho CRM OAuth Refresh ==========

/**
 * Odświeża token dostępu Zoho CRM przy użyciu refresh tokena.
 * Wymaga ustawionych Script Properties:
 * - ZOHO_GASP_CLIENT_ID
 * - ZOHO_GASP_CLIENT_SECRET
 * - ZOHO_GASP_REFRESH_TOKEN
 */
function refreshZohoToken() {
  const props = PropertiesService.getScriptProperties();
  const clientId = props.getProperty('ZOHO_GASP_CLIENT_ID');
  const clientSecret = props.getProperty('ZOHO_GASP_CLIENT_SECRET');
  const refreshToken = props.getProperty('ZOHO_GASP_REFRESH_TOKEN');

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('Brak wymaganych Script Properties dla Zoho OAuth (clientId / clientSecret / refreshToken)');
  }

  const url =
    'https://accounts.zoho.eu/oauth/v2/token' +
    '?refresh_token=' + encodeURIComponent(refreshToken) +
    '&client_id=' + encodeURIComponent(clientId) +
    '&client_secret=' + encodeURIComponent(clientSecret) +
    '&grant_type=refresh_token';

  const response = UrlFetchApp.fetch(url, {
    method: 'post',
    muteHttpExceptions: true,
  });

  if (response.getResponseCode() !== 200) {
    throw new Error('Nie udało się odświeżyć tokenu Zoho: ' + response.getContentText());
  }

  const data = JSON.parse(response.getContentText());
  if (!data.access_token) {
    throw new Error('Zoho nie zwróciło access_token: ' + response.getContentText());
  }

  const expiresInSec = Number(data.expires_in || 3600);
  const expiresAt = Date.now() + (expiresInSec - 60) * 1000; // odśwież 60s przed wygaśnięciem

  props.setProperty('ZOHO_GASP_ACCESS_TOKEN', data.access_token);
  props.setProperty('ZOHO_GASP_ACCESS_TOKEN_EXP', String(expiresAt));

  Logger.log('[Zoho OAuth] Access token odświeżony, wygasa o: ' + new Date(expiresAt).toISOString());
  return data.access_token;
}

/**
 * Zwraca ważny token dostępu do Zoho CRM, odświeżając go gdy potrzeba.
 */
function getZohoAccessToken() {
  const props = PropertiesService.getScriptProperties();
  const exp = Number(props.getProperty('ZOHO_GASP_ACCESS_TOKEN_EXP'));
  const token = props.getProperty('ZOHO_GASP_ACCESS_TOKEN');

  if (!exp || !token || Date.now() > exp) {
    return refreshZohoToken();
  }

  return token;
}

/**
 * Helper do wykonywania zapytań do API Zoho CRM z automatycznym dołączaniem tokenu.
 * @param {string} endpoint np. '/crm/v2/Accounts'
 * @param {string} method 'get'|'post'|'put'|'delete'
 * @param {Object} [body] payload dla POST/PUT
 */
function callZohoApi(endpoint, method, body) {
  if (!endpoint) {
    throw new Error('callZohoApi: endpoint jest wymagany (np. "/crm/v2/Accounts")');
  }
  
  const token = getZohoAccessToken();
  const options = {
    method: method || 'get',
    muteHttpExceptions: true,
    headers: {
      Authorization: 'Zoho-oauthtoken ' + token,
      'Content-Type': 'application/json',
    },
  };

  if (body) {
    options.payload = JSON.stringify(body);
  }

  const url = 'https://www.zohoapis.eu' + endpoint;
  const response = UrlFetchApp.fetch(url, options);
  const code = response.getResponseCode();
  const text = response.getContentText();

  if (code === 401) {
    // token mógł wygasnąć mimo danych w properties → spróbuj raz jeszcze
    refreshZohoToken();
    return callZohoApi(endpoint, method, body);
  }

  if (code >= 200 && code < 300) {
    return JSON.parse(text || '{}');
  }

  throw new Error('Zoho API error (' + code + '): ' + text);
}

/**
 * Bezpieczny wrapper: buduje endpoint w formacie /crm/v8/...
 * Uwaga: zostawiamy callZohoApi() jako bazę (obsługa 401 + token refresh).
 */
function callZohoApiV8(path, method, body) {
  const version = ZOHO_CRM_API_VERSION || 'v8';
  const endpoint = path.startsWith('/crm/') ? path : ('/crm/' + version + (path.startsWith('/') ? '' : '/') + path);
  return callZohoApi(endpoint, method, body);
}

// ========== COQL (Zoho) ==========
// Uniwersalny helper do zapytań COQL, żebyśmy mogli łatwo dodawać kolejne wyszukiwania.

function zohoEscapeCoqlString(value) {
  const str = (value === null || value === undefined) ? '' : String(value);
  // COQL używa apostrofów do stringów → escape ' oraz backslash
  return str.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/**
 * Buduje select_query COQL.
 * @param {Object} params
 * @param {string} params.module np. 'Accounts'
 * @param {string[]} params.fields np. ['id','Account_Name']
 * @param {string} params.where np. "(NIP = '123')"
 * @param {number} [params.limit] default 5
 * @param {string} [params.orderBy] np. 'Modified_Time'
 * @param {'ASC'|'DESC'} [params.order] default 'DESC'
 */
function buildZohoCoqlQuery(params) {
  if (!params || !params.module) throw new Error('buildZohoCoqlQuery: module jest wymagany');
  if (!params.where) throw new Error('buildZohoCoqlQuery: where jest wymagany');
  const fields = (params.fields && params.fields.length) ? params.fields : ['id'];
  const limit = typeof params.limit === 'number' ? params.limit : 5;
  const order = params.order || 'DESC';
  const orderBy = params.orderBy ? (' ORDER BY ' + params.orderBy + ' ' + order) : '';
  return 'SELECT ' + fields.join(', ') + ' FROM ' + params.module + ' WHERE ' + params.where + orderBy + ' LIMIT ' + limit;
}

/**
 * Wykonuje COQL i zwraca tablicę rekordów (response.data).
 */
function zohoCoql(params) {
  const query = typeof params === 'string' ? params : buildZohoCoqlQuery(params);
  // v8: {api-domain}/crm/{version}/coql (z dokumentacji v8)
  try {
    const responseV8 = callZohoApiV8('/coql', 'post', { select_query: query });
    return (responseV8 && responseV8.data) ? responseV8.data : [];
  } catch (e) {
    // Fallback do v2, jeśli w danym koncie/regionie COQL v8 okaże się niedostępne
    Logger.log('[Zoho][COQL] v8 failed, fallback to v2: ' + e);
    const responseV2 = callZohoApi('/crm/v2/coql', 'post', { select_query: query });
    return (responseV2 && responseV2.data) ? responseV2.data : [];
  }
}

// ========== ETAP C: Matching firm i kontaktów w Zoho CRM ==========

function normalizeNip(nip) {
  return (nip || '').toString().replace(/\D/g, '');
}

function normalizeCompanyName(name) {
  return (name || '').toString().trim().replace(/\s+/g, ' ').toUpperCase();
}

function normalizeDomain(value) {
  if (!value) return '';
  let domain = value.toString().trim().toLowerCase();
  domain = domain.replace(/^https?:\/\//, '');
  domain = domain.replace(/^www\./, '');
  const slashIndex = domain.indexOf('/');
  if (slashIndex !== -1) {
    domain = domain.substring(0, slashIndex);
  }
  return domain;
}

function normalizePhone(value) {
  return (value || '').toString().replace(/\D/g, '');
}

function buildAccountMatch(record, matchSource, candidate) {
  if (!record) return null;
  return {
    existsInCrm: true,
    crmId: record.id,
    crmData: record,
    matchSource: matchSource,
    needsEnrichment: candidate ? accountNeedsEnrichment(candidate, record) : false
  };
}

function buildContactMatch(record, matchSource, candidate) {
  if (!record) return null;
  return {
    existsInCrm: true,
    crmId: record.id,
    crmData: record,
    matchSource: matchSource,
    needsEnrichment: candidate ? contactNeedsEnrichment(candidate, record) : false
  };
}

function pickZohoRecord(response) {
  if (response && response.data && response.data.length) {
    return response.data[0];
  }
  return null;
}

// ===== Kontakty: bezpieczny wybór rekordu / niejednoznaczność =====

function normalizeNameValue(value) {
  return (value || '')
    .toString()
    .trim()
    .replace(/\s+/g, ' ')
    .toUpperCase();
}

function getCandidateNameParts(candidate) {
  const fn = (candidate && (candidate.first_name || candidate.firstName) || '').toString().trim();
  const ln = (candidate && (candidate.last_name || candidate.lastName) || '').toString().trim();
  return { firstName: fn, lastName: ln, hasFirst: !!fn, hasLast: !!ln, hasFull: !!fn && !!ln, hasAny: !!fn || !!ln };
}

function mapPossibleContactMatches(records) {
  const out = [];
  const seen = new Set();
  (records || []).forEach(function(r) {
    if (!r || !r.id) return;
    if (seen.has(r.id)) return;
    seen.add(r.id);
    out.push({
      crmId: r.id,
      Full_Name: r.Full_Name || r.full_name || null,
      Email: r.Email || r.email || null,
      Phone: r.Phone || r.phone || null,
      Mobile: r.Mobile || r.mobile || null,
      Account_Name: r.Account_Name || r.account_name || null
    });
  });
  return out;
}

function pickBestContactRecord(records, candidate) {
  const list = Array.isArray(records) ? records : [];
  if (!list.length) return { record: null, ambiguous: false, possible: [] };
  if (list.length === 1) return { record: list[0], ambiguous: false, possible: mapPossibleContactMatches(list) };

  const candEmail = (resolveCandidateEmail(candidate) || '').toString().trim().toLowerCase();
  const candPhone = normalizePhone(resolveCandidatePhone(candidate));
  const name = getCandidateNameParts(candidate);
  const fnUp = normalizeNameValue(name.firstName);
  const lnUp = normalizeNameValue(name.lastName);

  let best = null;
  let bestScore = -1;
  let secondScore = -1;

  list.forEach(function(r) {
    let score = 0;
    const rEmail = (r.Email || r.email || '').toString().trim().toLowerCase();
    const rPhone = normalizePhone(r.Phone || r.phone || '');
    const rMobile = normalizePhone(r.Mobile || r.mobile || '');
    const rFnUp = normalizeNameValue(r.First_Name || r.first_name || '');
    const rLnUp = normalizeNameValue(r.Last_Name || r.last_name || '');

    if (candEmail && rEmail && candEmail === rEmail) score += 100;
    if (candPhone && (candPhone === rPhone || candPhone === rMobile)) score += 60;
    if (fnUp && rFnUp && fnUp === rFnUp) score += 25;
    if (lnUp && rLnUp && lnUp === rLnUp) score += 25;
    if (fnUp && lnUp && rFnUp && rLnUp && fnUp === rFnUp && lnUp === rLnUp) score += 20;

    if (score > bestScore) {
      secondScore = bestScore;
      bestScore = score;
      best = r;
    } else if (score > secondScore) {
      secondScore = score;
    }
  });

  // jeśli różnica między najlepszym a drugim jest mała, traktuj jako niejednoznaczne
  const ambiguous = bestScore >= 0 && secondScore >= 0 && (bestScore - secondScore) < 30;
  return { record: ambiguous ? null : best, ambiguous: ambiguous, possible: mapPossibleContactMatches(list) };
}

function isDepartmentLikeEmail(email) {
  const value = (email || '').toString().trim().toLowerCase();
  if (!value || value.indexOf('@') === -1) return false;
  const local = value.split('@')[0] || '';
  const localNorm = local.replace(/[._-]/g, '');
  const deny = [
    'info', 'kontakt', 'contact', 'office', 'biuro', 'sekretariat', 'recepcja', 'rejestracja',
    'sales', 'sprzedaz', 'marketing', 'pr', 'media', 'hr', 'kadry', 'rekrutacja', 'support', 'pomoc',
    'admin', 'administracja', 'bok', 'hello', 'team'
  ];
  // Exact match OR common variations like: biuro.krakow@, sekretariat-1@, kontakt_pl@ (po normalizacji znaków)
  for (var i = 0; i < deny.length; i++) {
    var token = deny[i];
    if (!token) continue;
    if (localNorm === token) return true;
    // ostrożnie: tylko prefix/suffix, żeby nie łapać przypadkowych substringów
    if (localNorm.indexOf(token) === 0) return true;
    if (localNorm.lastIndexOf(token) === (localNorm.length - token.length)) return true;
  }
  return false;
}

function pickBestAccountRecord(records, candidate, domainHint) {
  if (!records || !records.length) return null;
  if (records.length === 1) return records[0];

  const candName = normalizeCompanyName(candidate && (candidate.company_name || candidate.name || '') || '');
  const candNip = normalizeNip(candidate && candidate.nip);
  const candDomain = normalizeDomain(domainHint || getCandidateDomain(candidate));

  let best = null;
  let bestScore = -1;
  let secondScore = -1;

  records.forEach(function(r) {
    let score = 0;
    const rNip = normalizeNip(r.NIP || r.nip);
    const rName = normalizeCompanyName(r.Account_Name || r.account_name || r.Company_Name || '');
    const rFriendly = normalizeCompanyName(r.Nazwa_zwyczajowa || r.nazwa_zwyczajowa || '');
    const rWebsite = normalizeDomain(r.Website || r.website || '');

    if (candNip && rNip && candNip === rNip) score += 100;
    if (candDomain && rWebsite && rWebsite.indexOf(candDomain) !== -1) score += 30;
    if (candName && rName && candName === rName) score += 20;
    if (candName && rFriendly && (rFriendly.indexOf(candName) !== -1 || candName.indexOf(rFriendly) !== -1)) score += 10;

    if (score > bestScore) {
      secondScore = bestScore;
      bestScore = score;
      best = r;
    } else if (score > secondScore) {
      secondScore = score;
    }
  });

  // Jeśli wynik nie jest wystarczająco pewny lub jest remis → nie wybieraj losowo pierwszego
  if (bestScore < 20 || bestScore === secondScore) {
    return null;
  }
  return best;
}

function searchAccountsByNip(nip, candidate) {
  const normalized = normalizeNip(nip);
  if (!normalized) return null;
  try {
    const where = "(NIP = '" + zohoEscapeCoqlString(normalized) + "')";
    const records = zohoCoql({
      module: 'Accounts',
      fields: ['id', 'Account_Name', 'Website', 'NIP', 'Nazwa_zwyczajowa', 'Phone', 'Email', 'Billing_Street', 'Billing_City', 'Billing_Code', 'Billing_State'],
      where: where,
      limit: 5
    });
    const record = pickBestAccountRecord(records, candidate, null) || (records.length === 1 ? records[0] : null);
    return buildAccountMatch(record, 'nip', candidate);
  } catch (error) {
    Logger.log('[Zoho] searchAccountsByNip error: ' + error);
    return null;
  }
}

function searchAccountsByName(name, candidate) {
  const raw = (name || '').toString().trim();
  const normalized = normalizeCompanyName(raw);
  if (!raw && !normalized) return null;
  try {
    const fields = ['id', 'Account_Name', 'Website', 'NIP', 'Nazwa_zwyczajowa', 'Phone', 'Email', 'Billing_Street', 'Billing_City', 'Billing_Code', 'Billing_State'];
    const domainHint = getCandidateDomain(candidate);

    // 1) dokładna nazwa (raw)
    if (raw) {
      const whereExact = "(Account_Name = '" + zohoEscapeCoqlString(raw) + "')";
      const recordsExact = zohoCoql({ module: 'Accounts', fields: fields, where: whereExact, limit: 5 });
      const bestExact = pickBestAccountRecord(recordsExact, candidate, domainHint);
      if (bestExact) return buildAccountMatch(bestExact, 'name', candidate);
      if (recordsExact.length === 1) return buildAccountMatch(recordsExact[0], 'name', candidate);
    }

    // 2) fallback: starts_with na nazwie zwyczajowej (bardziej restrykcyjne niż contains)
    if (normalized && normalized.length >= 3) {
      const whereFriendly = "(Nazwa_zwyczajowa like '" + zohoEscapeCoqlString(normalized) + "%')";
      const recordsFriendly = zohoCoql({ module: 'Accounts', fields: fields, where: whereFriendly, limit: 5 });
      const bestFriendly = pickBestAccountRecord(recordsFriendly, candidate, domainHint);
      if (bestFriendly) return buildAccountMatch(bestFriendly, 'name', candidate);
      if (recordsFriendly.length === 1) return buildAccountMatch(recordsFriendly[0], 'name', candidate);
    }

    // 3) fallback: starts_with po Account_Name (bezpieczniejsze niż contains)
    if (normalized && normalized.length >= 4) {
      const wherePrefix = "(Account_Name like '" + zohoEscapeCoqlString(normalized) + "%')";
      const recordsPrefix = zohoCoql({ module: 'Accounts', fields: fields, where: wherePrefix, limit: 5 });
      const bestPrefix = pickBestAccountRecord(recordsPrefix, candidate, domainHint);
      if (bestPrefix) return buildAccountMatch(bestPrefix, 'name', candidate);
      if (recordsPrefix.length === 1) return buildAccountMatch(recordsPrefix[0], 'name', candidate);
    }

    // Niejednoznaczne / brak
    if (raw || normalized) {
      saveLogToDrive({ source: 'ZOHO_MATCHING', message: 'Account name search ambiguous or empty results: ' + (raw || normalized) });
    }
    return null;
  } catch (error) {
    Logger.log('[Zoho] searchAccountsByName error: ' + error);
    return null;
  }
}

function searchAccountsByDomain(domain, candidate) {
  const normalized = normalizeDomain(domain);
  if (!normalized) return null;
  try {
    const where = "(Website like '%" + zohoEscapeCoqlString(normalized) + "%')";
    const records = zohoCoql({
      module: 'Accounts',
      fields: ['id', 'Account_Name', 'Website', 'NIP', 'Nazwa_zwyczajowa', 'Phone', 'Email', 'Billing_Street', 'Billing_City', 'Billing_Code', 'Billing_State'],
      where: where,
      limit: 5
    });
    const record = pickBestAccountRecord(records, candidate, normalized) || (records.length === 1 ? records[0] : null);
    if (!record && records.length > 1) {
      saveLogToDrive({ source: 'ZOHO_MATCHING', message: 'Account domain search ambiguous: domain=' + normalized + ', hits=' + records.length });
    }
    return buildAccountMatch(record, 'domain', candidate);
  } catch (error) {
    Logger.log('[Zoho] searchAccountsByDomain error: ' + error);
    return null;
  }
}

function searchContactsByEmail(email, candidate) {
  const normalized = (email || '').toString().trim().toLowerCase();
  if (!normalized) return null;
  try {
    // v8 Search Records: GET /Contacts/search?email=...
    const response = callZohoApiV8('/Contacts/search?email=' + encodeURIComponent(normalized), 'get');
    const picked = pickBestContactRecord(response && response.data, candidate);
    if (picked.ambiguous) return null;
    return buildContactMatch(picked.record, 'email', candidate);
  } catch (error) {
    // fallback v2
    try {
      Logger.log('[Zoho] searchContactsByEmail v8 failed, fallback v2: ' + error);
      const criteria = encodeURIComponent('(Email:equals:' + normalized + ')');
      const responseV2 = callZohoApi('/crm/v2/Contacts/search?criteria=' + criteria, 'get');
      const picked = pickBestContactRecord(responseV2 && responseV2.data, candidate);
      if (picked.ambiguous) return null;
      return buildContactMatch(picked.record, 'email', candidate);
    } catch (e2) {
      Logger.log('[Zoho] searchContactsByEmail error: ' + e2);
      return null;
    }
  }
}

function searchContactByNameAndEmail(firstName, lastName, email, candidate) {
  const normalizedEmail = (email || '').toString().trim().toLowerCase();
  if (!normalizedEmail) return null;
  const fn = (firstName || '').toString().trim();
  const ln = (lastName || '').toString().trim();
  const parts = [];
  if (fn) parts.push('(First_Name:equals:' + fn + ')');
  if (ln) parts.push('(Last_Name:equals:' + ln + ')');
  parts.push('(Email:equals:' + normalizedEmail + ')');
  const criteria = encodeURIComponent('(' + parts.join(' and ') + ')');
  try {
    const response = callZohoApi('/crm/v2/Contacts/search?criteria=' + criteria, 'get');
    const picked = pickBestContactRecord(response && response.data, candidate);
    if (picked.ambiguous) return null;
    return buildContactMatch(picked.record, 'name+email', candidate);
  } catch (error) {
    Logger.log('[Zoho] searchContactByNameAndEmail error: ' + error);
    return null;
  }
}

function searchContactsByPhone(phone, candidate) {
  const normalized = normalizePhone(phone);
  if (!normalized) return null;
  try {
    // v8 Search Records: GET /Contacts/search?phone=...
    // Uwaga: v8 criteria nie wspiera operatora "contains" dla pól Phone/Email (zamiast tego jest equals/starts_with),
    // więc używamy dedykowanego parametru phone.
    const response = callZohoApiV8('/Contacts/search?phone=' + encodeURIComponent(normalized), 'get');
    const picked = pickBestContactRecord(response && response.data, candidate);
    if (picked.ambiguous) return null;
    return buildContactMatch(picked.record, 'phone', candidate);
  } catch (error) {
    // fallback v2 (stara logika criteria/contains)
    try {
      Logger.log('[Zoho] searchContactsByPhone v8 failed, fallback v2: ' + error);
      const criteria = encodeURIComponent('((Phone:contains:' + normalized + ') or (Mobile:contains:' + normalized + '))');
      const responseV2 = callZohoApi('/crm/v2/Contacts/search?criteria=' + criteria, 'get');
      const picked = pickBestContactRecord(responseV2 && responseV2.data, candidate);
      if (picked.ambiguous) return null;
      return buildContactMatch(picked.record, 'phone', candidate);
    } catch (e2) {
      Logger.log('[Zoho] searchContactsByPhone error: ' + e2);
      return null;
    }
  }
}

function accountNeedsEnrichment(candidate, record) {
  if (!candidate || !record) return false;
  const map = {
    phone: 'Phone',
    email: 'Email',
    website: 'Website',
    billingStreet: 'Billing_Street',
    billingCity: 'Billing_City',
    billingZip: 'Billing_Code',
    billingState: 'Billing_State'
  };
  return Object.keys(map).some(key => {
    const candidateValue = candidate[key];
    if (!candidateValue) return false;
    const zohoField = map[key];
    const zohoValue = record[zohoField];
    return !zohoValue || zohoValue === '';
  });
}

function contactNeedsEnrichment(candidate, record) {
  if (!candidate || !record) return false;
  const map = {
    phone: 'Phone',
    mobile: 'Mobile',
    email: 'Email',
    designation: 'Designation',
    department: 'Department'
  };
  return Object.keys(map).some(key => {
    const candidateValue = candidate[key];
    if (!candidateValue) return false;
    const zohoField = map[key];
    const zohoValue = record[zohoField];
    return !zohoValue || zohoValue === '';
  });
}

function getCandidateDomain(candidate) {
  if (!candidate) return '';
  if (candidate.domain) return candidate.domain;
  if (candidate.websiteDomain) return candidate.websiteDomain;
  if (candidate.website) return candidate.website;
  if (candidate.email) {
    const parts = candidate.email.split('@');
    if (parts.length === 2) return parts[1];
  }
  if (candidate.emails && candidate.emails.length) {
    const entry = candidate.emails.find(e => e);
    if (entry) {
      const value = typeof entry === 'string' ? entry : entry.value;
      if (value && value.includes('@')) {
        return value.split('@')[1];
      }
    }
  }
  return '';
}

function resolveCandidateEmail(candidate) {
  if (!candidate) return '';
  if (candidate.email) return candidate.email;
  if (Array.isArray(candidate.emails) && candidate.emails.length) {
    const entry = candidate.emails.find(e => e);
    if (entry) {
      return typeof entry === 'string' ? entry : entry.value || '';
    }
  }
  return '';
}

function resolveCandidatePhone(candidate) {
  if (!candidate) return '';
  if (candidate.phone) return candidate.phone;
  if (candidate.mobile) return candidate.mobile;
  if (Array.isArray(candidate.phones) && candidate.phones.length) {
    const entry = candidate.phones.find(e => e);
    if (entry) {
      return typeof entry === 'string' ? entry : entry.value || '';
    }
  }
  if (Array.isArray(candidate.mobiles) && candidate.mobiles.length) {
    const entry = candidate.mobiles.find(e => e);
    if (entry) {
      return typeof entry === 'string' ? entry : entry.value || '';
    }
  }
  return '';
}

function parseJsonArrayProperty(props, key) {
  const raw = props.getProperty(key);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed
        .map(entry => {
          if (entry === null || entry === undefined) return '';
          return entry.toString().trim();
        })
        .filter(Boolean);
    }
  } catch (error) {
    Logger.log('[IgnoreRules] Nie można sparsować ' + key + ': ' + error.toString());
  }
  return [];
}

function loadIgnoreRules() {
  const props = PropertiesService.getScriptProperties();
  const domainList = parseJsonArrayProperty(props, 'IGNORED_DOMAINS_JSON')
    .map(normalizeDomain)
    .filter(Boolean);
  const companyList = parseJsonArrayProperty(props, 'IGNORED_COMPANIES_JSON')
    .map(normalizeCompanyName)
    .filter(Boolean);
  const patternList = parseJsonArrayProperty(props, 'IGNORED_PATTERNS_JSON')
    .map(value => value.toString().toLowerCase())
    .filter(Boolean);

  return {
    hasRules: Boolean(domainList.length || companyList.length || patternList.length),
    domainSet: new Set(domainList),
    companySet: new Set(companyList),
    patterns: patternList
  };
}

function getDomainFromEmail(email) {
  if (!email) return '';
  const parts = email.toString().trim().split('@');
  if (parts.length !== 2) return '';
  return normalizeDomain(parts[1]);
}

function matchesIgnorePatterns(values, patterns) {
  if (!patterns || !patterns.length) return false;
  return values.some(value => {
    if (!value) return false;
    const normalized = value.toString().toLowerCase();
    return patterns.some(pattern => normalized.indexOf(pattern) !== -1);
  });
}

function shouldIgnoreCompany(company, rules) {
  if (!company || !rules || !rules.hasRules) return null;

  const domain = getCandidateDomain(company);
  if (domain && rules.domainSet.has(domain)) {
    return { reason: 'domain', value: domain };
  }

  const name = normalizeCompanyName(company.company_name || company.name || '');
  if (name && rules.companySet.has(name)) {
    return { reason: 'company', value: name };
  }

  if (
    matchesIgnorePatterns(
      [
        company.company_name,
        company.name,
        company.friendly_name,
        domain,
        company.website,
        company.notes
      ],
      rules.patterns
    )
  ) {
    return { reason: 'pattern', value: company.company_name || company.name || domain };
  }

  return null;
}

function shouldIgnoreContact(contact, rules) {
  if (!contact || !rules || !rules.hasRules) return null;

  const email = resolveCandidateEmail(contact);
  const domain = getDomainFromEmail(email) || getCandidateDomain(contact);

  // Gating: nie traktuj skrzynek ogólnych (sekretariat/info/kontakt/biuro...) jako "osoby"
  // Jeśli brak imienia/nazwiska, pomiń taki kontakt już na etapie filtrów (żeby nie trafiał do UI/matchingu).
  const nameParts = getCandidateNameParts(contact);
  if (email && isDepartmentLikeEmail(email) && !nameParts.hasAny) {
    return { reason: 'department_email_no_person', value: email };
  }

  if (domain && rules.domainSet.has(domain)) {
    return { reason: 'domain', value: domain };
  }

  const companyName = normalizeCompanyName(contact.company_name || contact.company || '');
  if (companyName && rules.companySet.has(companyName)) {
    return { reason: 'company', value: companyName };
  }

  const fullName = [
    contact.first_name || contact.firstName || '',
    contact.last_name || contact.lastName || ''
  ]
    .join(' ')
    .trim();

  if (
    matchesIgnorePatterns(
      [
        fullName,
        email,
        domain,
        contact.phone,
        contact.mobile,
        contact.designation,
        contact.department
      ],
      rules.patterns
    )
  ) {
    return { reason: 'pattern', value: fullName || email || domain };
  }

  return null;
}

function applyIgnoreFilters(analysis, rules) {
  const source = analysis || {};
  const companiesSource = Array.isArray(source.companies) ? source.companies : [];
  const contactsSource = Array.isArray(source.contacts) ? source.contacts : [];

  if (!rules || !rules.hasRules) {
    return {
      companies: companiesSource.slice(),
      contacts: contactsSource.slice(),
      ignoredCompanies: 0,
      ignoredContacts: 0
    };
  }

  const filteredCompanies = [];
  let ignoredCompanies = 0;
  companiesSource.forEach(company => {
    const reason = shouldIgnoreCompany(company, rules);
    if (reason) {
      ignoredCompanies += 1;
      Logger.log(
        '[GAS][Ignore] Pomijam firmę (' +
          reason.reason +
          '): ' +
          (company.company_name || company.name || '[brak nazwy]')
      );
      return;
    }
    filteredCompanies.push(company);
  });

  const filteredContacts = [];
  let ignoredContacts = 0;
  contactsSource.forEach(contact => {
    const reason = shouldIgnoreContact(contact, rules);
    if (reason) {
      ignoredContacts += 1;
      const contactName =
        (contact.first_name || contact.firstName || '') +
        ' ' +
        (contact.last_name || contact.lastName || '');
      let displayName = contactName.trim();
      if (!displayName) {
        displayName = contact.email || resolveCandidateEmail(contact) || '[brak nazwy]';
      }
      Logger.log(
        '[GAS][Ignore] Pomijam kontakt (' +
          reason.reason +
          '): ' +
          displayName
      );
      return;
    }
    filteredContacts.push(contact);
  });

  return {
    companies: filteredCompanies,
    contacts: filteredContacts,
    ignoredCompanies: ignoredCompanies,
    ignoredContacts: ignoredContacts
  };
}

function emptyMatch() {
  return {
    existsInCrm: false,
    crmId: null,
    crmData: null,
    matchSource: null,
    needsEnrichment: false,
    possibleCrmMatches: []
  };
}

// ===== Firmy: hint search (possible_match) =====

var COMPANY_KEYWORD_STOPWORDS = [
  'SP', 'Z', 'OO', 'O.O.', 'SP.', 'SPÓŁKA', 'SPOLKA', 'S.A', 'SA', 'LTD', 'LLC',
  'MEDICAL', 'MEDYCZNA', 'KLINIKA', 'CLINIC', 'CENTER', 'CENTRUM', 'HOSPITAL', 'SZPITAL',
  'GROUP', 'GRUPA', 'POLSKA', 'EUROPE', 'EU'
];

function isStopword(token) {
  if (!token) return true;
  const up = token.toString().trim().toUpperCase();
  if (!up) return true;
  return COMPANY_KEYWORD_STOPWORDS.indexOf(up) !== -1;
}

function extractCompanyKeyword(candidate) {
  if (!candidate) return '';
  const explicit =
    candidate.company_keyword || // docelowe pole z LLM (snake_case)
    candidate.companyKeyword ||  // kompatybilność wstecz (gdyby ktoś dodał camelCase)
    candidate.keyword ||         // kompatybilność wstecz
    '';
  const rawName = (candidate.company_name || candidate.name || candidate.company_friendly_name || '').toString().trim();
  const source = explicit ? explicit.toString().trim() : rawName;
  if (!source) return '';

  // Weź maks 2 tokeny (ale preferuj 1), usuń stopwords i krótkie tokeny
  const tokens = source
    .replace(/[^\p{L}\p{N}\s.-]/gu, ' ')
    .split(/\s+/)
    .map(t => t.trim())
    .filter(Boolean)
    .map(t => t.toUpperCase())
    .filter(t => t.length >= 4)
    .filter(t => !isStopword(t));

  if (!tokens.length) return '';
  // Zwróć 1 token (najbardziej restrykcyjnie); drugi token zostawiamy na przyszłość, jeśli zechcesz
  return tokens[0];
}

function mapPossibleAccountMatches(records) {
  const out = [];
  const seen = new Set();
  (records || []).forEach(function(r) {
    if (!r || !r.id) return;
    if (seen.has(r.id)) return;
    seen.add(r.id);
    out.push({
      crmId: r.id,
      Account_Name: r.Account_Name || null,
      Website: r.Website || null,
      NIP: r.NIP || null
    });
  });
  return out;
}

function findPossibleAccountsByDomain(domain) {
  const normalized = normalizeDomain(domain);
  if (!normalized) return [];
  const where = "(Website like '%" + zohoEscapeCoqlString(normalized) + "%')";
  const records = zohoCoql({
    module: 'Accounts',
    fields: ['id', 'Account_Name', 'Website', 'NIP'],
    where: where,
    limit: 5
  });
  return mapPossibleAccountMatches(records);
}

function findPossibleAccountsByKeyword(keyword) {
  const kw = (keyword || '').toString().trim().toUpperCase();
  if (!kw || kw.length < 4 || isStopword(kw)) return [];
  const where = "(Account_Name like '%" + zohoEscapeCoqlString(kw) + "%')";
  const records = zohoCoql({
    module: 'Accounts',
    fields: ['id', 'Account_Name', 'Website', 'NIP'],
    where: where,
    limit: 5
  });
  return mapPossibleAccountMatches(records);
}

function findPossibleAccountsCombined(domain, keyword) {
  const normalizedDomain = normalizeDomain(domain);
  const kw = (keyword || '').toString().trim().toUpperCase();
  const hasDomain = Boolean(normalizedDomain);
  const hasKeyword = Boolean(kw && kw.length >= 4 && !isStopword(kw));
  if (!hasDomain && !hasKeyword) return [];

  const parts = [];
  if (hasDomain) {
    parts.push("(Website like '%" + zohoEscapeCoqlString(normalizedDomain) + "%')");
  }
  if (hasKeyword) {
    parts.push("(Account_Name like '%" + zohoEscapeCoqlString(kw) + "%')");
  }

  const where = '(' + parts.join(' or ') + ')';
  const records = zohoCoql({
    module: 'Accounts',
    fields: ['id', 'Account_Name', 'Website', 'NIP'],
    where: where,
    limit: 5
  });
  return mapPossibleAccountMatches(records);
}

function matchAccountCandidate(candidate) {
  if (!candidate) return emptyMatch();

  var candidateJson = JSON.stringify(candidate);
  Logger.log('[Zoho Matching] 🔍 Account candidate: ' + candidateJson);
  saveLogToDrive({ source: 'ZOHO_MATCHING', message: 'Account candidate: ' + candidateJson });

  // ZASADA SYSTEMOWA: existsInCrm dla firmy ustawiamy WYŁĄCZNIE po NIP.
  // Domena/nazwa/keyword służą tylko jako "possible match" (hint), nigdy jako twardy match.
  var match = null;

  if (candidate.nip) {
    Logger.log('[Zoho Matching] Szukam po NIP: ' + candidate.nip);
    match = searchAccountsByNip(candidate.nip, candidate);
    if (match && match.existsInCrm) {
      Logger.log('[Zoho Matching] ✅ Match by NIP, crmId=' + match.crmId);
      saveLogToDrive({ source: 'ZOHO_MATCHING', message: 'Match by NIP: crmId=' + match.crmId });
      return match;
    }
    // Jeśli NIP jest, ale nie ma matchu → rekord w CRM nie istnieje wg polityki, ale możemy dać hinty (wykrycie potencjalnych duplikatów).
  }

  // Hint search (possible_match)
  var domain = getCandidateDomain(candidate);
  var kw = extractCompanyKeyword(candidate);
  Logger.log('[Zoho Matching] Hint (COQL OR): domain=' + (domain || '-') + ', keyword=' + (kw || '-'));
  var possible = findPossibleAccountsCombined(domain, kw);
  // de-dup (po crmId)
  if (possible.length) {
    const seen = new Set();
    possible = possible.filter(function(p) {
      if (!p || !p.crmId) return false;
      if (seen.has(p.crmId)) return false;
      seen.add(p.crmId);
      return true;
    });
    saveLogToDrive({ source: 'ZOHO_MATCHING', message: 'Possible matches found: ' + possible.length });
  }

  Logger.log('[Zoho Matching] ❌ Account not found in CRM');
  saveLogToDrive({ source: 'ZOHO_MATCHING', message: 'Account not found (by NIP): ' + (candidate.company_name || candidate.name || 'unknown') });
  var out = emptyMatch();
  out.possibleCrmMatches = possible;
  return out;
}

function matchContactCandidate(candidate) {
  if (!candidate) return emptyMatch();

  var candidateJson = JSON.stringify(candidate);
  Logger.log('[Zoho Matching] 🔍 Contact candidate: ' + candidateJson);
  saveLogToDrive({ source: 'ZOHO_MATCHING', message: 'Contact candidate: ' + candidateJson });

  var match = null;
  var email = resolveCandidateEmail(candidate);
  var phone = resolveCandidatePhone(candidate);
  var name = getCandidateNameParts(candidate);

  // email_is_personal w tym projekcie = "email imienny służbowy (direct) vs ogólny/działowy"
  var emailDirectBusiness = candidate.email_is_personal === true;
  var emailDepartmentLike = isDepartmentLikeEmail(email) || (candidate.email_is_personal === false);

  // Anty-błąd: nie dopasowuj "sekretariat@" jako osoby, jeśli nie mamy żadnego imienia/nazwiska
  if (email && emailDepartmentLike && !name.hasAny) {
    Logger.log('[Zoho Matching] ⛔ Pomijam contact match: ogólny email bez osoby: ' + email);
    saveLogToDrive({ source: 'ZOHO_MATCHING', message: 'Skip contact match: department-like email without person: ' + email });
    return emptyMatch();
  }

  // 1) Email bezpośrednio służbowy (imienny): wolno szukać po emailu
  if (email && emailDirectBusiness) {
    Logger.log('[Zoho Matching] Szukam po email (direct business): ' + email);
    match = searchContactsByEmail(email, candidate);
    if (match && match.existsInCrm) {
      Logger.log('[Zoho Matching] ✅ Match by email (direct), crmId=' + match.crmId);
      saveLogToDrive({ source: 'ZOHO_MATCHING', message: 'Match by email (direct): crmId=' + match.crmId });
      return match;
    }
  }

  // 2) Email ogólny/niepewny: tylko name+email (i to najlepiej pełne imię+nazwisko)
  if (email && !emailDirectBusiness) {
    var firstName = name.firstName || '';
    var lastName = name.lastName || '';
    if (name.hasFull) {
      Logger.log('[Zoho Matching] Szukam po name+email (non-direct): ' + firstName + ' ' + lastName + ' / ' + email);
      match = searchContactByNameAndEmail(firstName, lastName, email, candidate);
      if (match && match.existsInCrm) {
        Logger.log('[Zoho Matching] ✅ Match by name+email (non-direct), crmId=' + match.crmId);
        saveLogToDrive({ source: 'ZOHO_MATCHING', message: 'Match by name+email (non-direct): crmId=' + match.crmId });
        return match;
      }
    }
  }

  // 3) Telefon: szukaj tylko jeśli mamy też jakąś część imienia/nazwiska (żeby nie brać pierwszego lepszego)
  if (phone && name.hasAny) {
    Logger.log('[Zoho Matching] Szukam po telefonie (z imieniem/nazwiskiem): ' + phone);
    match = searchContactsByPhone(phone, candidate);
    if (match && match.existsInCrm) {
      Logger.log('[Zoho Matching] ✅ Match by phone, crmId=' + match.crmId);
      saveLogToDrive({ source: 'ZOHO_MATCHING', message: 'Match by phone: crmId=' + match.crmId });
      return match;
    }
  }

  var contactName = (candidate.first_name || '') + ' ' + (candidate.last_name || '');
  Logger.log('[Zoho Matching] ❌ Contact not found in CRM: ' + contactName.trim());
  saveLogToDrive({ source: 'ZOHO_MATCHING', message: 'Contact not found: ' + contactName.trim() });
  return emptyMatch();
}

// Funkcja do pobrania lub utworzenia folderu z logami
function getOrCreateLogFolder() {
  const folders = DriveApp.getFoldersByName(LOG_FOLDER_NAME);
  
  if (folders.hasNext()) {
    return folders.next();
  } else {
    // Utwórz nowy folder
    const folder = DriveApp.createFolder(LOG_FOLDER_NAME);
    Logger.log('Utworzono folder logów: ' + LOG_FOLDER_NAME);
    return folder;
  }
}

// Funkcja do zapisania logu do pliku
function saveLogToDrive(logData) {
  try {
    const folder = getOrCreateLogFolder();
    
    // Nazwa pliku: data (jeden plik na dzień)
    const now = new Date();
    const timezone = 'Europe/Warsaw'; // Stała strefa czasowa
    const dateStr = Utilities.formatDate(now, timezone, 'yyyy-MM-dd');
    const fileName = `log_${dateStr}.txt`;
    
    // Sprawdź czy dzisiejszy plik już istnieje
    const files = folder.getFilesByName(fileName);
    let logFile = null;
    
    if (files.hasNext()) {
      // Plik istnieje - użyj go
      logFile = files.next();
    } else {
      // Utwórz nowy plik
      logFile = folder.createFile(fileName, '=== Log ZCRM CCE2 - ' + dateStr + ' ===\n\n');
    }
    
    // Dodaj log do pliku
    const timestamp = Utilities.formatDate(now, timezone, 'yyyy-MM-dd HH:mm:ss');
    const logEntry = `[${timestamp}] ${logData.source}: ${logData.message}\n`;
    
    // Pobierz istniejącą zawartość i dodaj nowy wpis
    const existingContent = logFile.getBlob().getDataAsString();
    logFile.setContent(existingContent + logEntry);
    
    return {
      success: true,
      fileName: logFile.getName(),
      folderName: LOG_FOLDER_NAME
    };
    
  } catch (error) {
    Logger.log('Błąd zapisu logu: ' + error.toString());
    return {
      success: false,
      error: error.toString()
    };
  }
}

function truncateForLog(value, maxLength) {
  if (!value) return '';
  const str = value.toString();
  if (str.length <= maxLength) return str;
  return str.substring(0, Math.max(0, maxLength - 3)) + '...';
}

function logFetchedMessagesSummary(context, details) {
  try {
    if (!details || !Array.isArray(details.messages)) {
      return;
    }
    const header =
      `${context} | thread=${details.threadId || '-'} | refMessage=${details.messageId || '-'} | count=${details.messages.length}`;
    const lines = details.messages.map((item, idx) => {
      const parts = [
        `[${idx + 1}] msg=${item.id || '-'}`,
        `from=${truncateForLog(item.from || '', 50)}`,
        `subj=${truncateForLog(item.subject || '', 80)}`,
        `plainChars=${item.plainChars || 0}`
      ];
      if (item.htmlChars !== undefined) {
        parts.push(`htmlChars=${item.htmlChars}`);
      }
      if (item.snippetChars !== undefined) {
        parts.push(`snippetChars=${item.snippetChars}`);
      }
      if (item.attachmentsCount !== undefined) {
        parts.push(`attachments=${item.attachmentsCount}`);
      }
      return '  ' + parts.join(' | ');
    });
    saveLogToDrive({
      source: 'GMAIL_FETCH',
      message: header + '\n' + lines.join('\n')
    });
  } catch (error) {
    Logger.log('[LogHelper] logFetchedMessagesSummary error: ' + error);
  }
}

function logGeminiJsonResult(messageId, analysis, metadata) {
  try {
    if (!analysis) return;
    const jsonString = JSON.stringify(analysis);
    const metaInfo = metadata ? JSON.stringify(metadata) : '{}';
    const message =
      `messageId=${messageId || '-'} | jsonLength=${jsonString.length}\n` +
      `metadata=${metaInfo}\n` +
      jsonString;
    saveLogToDrive({
      source: 'GEMINI_JSON',
      message: message
    });
  } catch (error) {
    Logger.log('[LogHelper] logGeminiJsonResult error: ' + error);
  }
}

// ========== ETAP 2: Gmail API Fetch Functions ==========

// ETAP 2*: Thread Intelligence - szybkie sprawdzenie + lista messageIds (20-50ms)
function getThreadMetadata(messageId) {
  try {
    if (!messageId || messageId.trim() === '') {
      return {
        success: false,
        error: 'messageId jest pusty'
      };
    }
    
    // Pobierz wiadomość aby dostać się do wątku
    const message = GmailApp.getMessageById(messageId);
    
    if (!message) {
      return {
        success: false,
        error: 'Wiadomość nie znaleziona'
      };
    }
    
    // Pobierz wątek
    const thread = message.getThread();
    
    if (!thread) {
      return {
        success: false,
        error: 'Wątek nie znaleziony'
      };
    }
    
    // SZYBKIE wywołanie - tylko metadata, bez ciał wiadomości
    const messageCount = thread.getMessageCount();
    const messages = thread.getMessages(); // Obiekty wiadomości (bez pobierania ciał)
    
    // Wyciągnij messageIds
    const messageIds = messages.map(function(msg) {
      return msg.getId();
    });
    
    return {
      success: true,
      messageId: messageId,
      threadId: thread.getId(), // Prawdziwy thread ID z API
      messageCount: messageCount,
      hasMultipleMessages: messageCount > 1,
      messageIds: messageIds  // Lista wszystkich messageIds w wątku
    };
    
  } catch (error) {
    Logger.log('Błąd getThreadMetadata: ' + error.toString());
    return {
      success: false,
      error: error.toString()
    };
  }
}

// Funkcja do pobrania pełnych danych wiadomości (manual-fetch)
function fetchMessageFull(messageId, threadId) {
  try {
    const message = GmailApp.getMessageById(messageId);
    
    if (!message) {
      return {
        success: false,
        error: 'Wiadomość nie znaleziona'
      };
    }
    const messageThread = message.getThread();
    const derivedThreadId = threadId || (messageThread ? messageThread.getId() : '');
    const plainBody = message.getPlainBody();
    const htmlBody = message.getBody();
    const attachments = message.getAttachments().map(att => ({
      name: att.getName(),
      size: att.getSize(),
      type: att.getContentType()
    }));

    logFetchedMessagesSummary('FETCH_MESSAGE', {
      threadId: derivedThreadId,
      messageId: messageId,
      messages: [{
        id: messageId,
        from: message.getFrom(),
        subject: message.getSubject(),
        plainChars: plainBody ? plainBody.length : 0,
        htmlChars: htmlBody ? htmlBody.length : 0,
        attachmentsCount: attachments.length
      }]
    });
    
    return {
      success: true,
      messageId: messageId,
      threadId: threadId,
      subject: message.getSubject(),
      from: message.getFrom(),
      to: message.getTo(),
      cc: message.getCc(),
      bcc: message.getBcc(),
      date: message.getDate().toISOString(),
      plainBody: plainBody,
      htmlBody: htmlBody,
      attachments: attachments,
      headers: {
        'Message-ID': message.getId(),
        'Reply-To': message.getReplyTo()
      }
    };
    
  } catch (error) {
    Logger.log('Błąd fetchMessageFull: ' + error.toString());
    return {
      success: false,
      error: error.toString()
    };
  }
}

// Funkcja do pobrania pełnego wątku (manual-fetch)
// UWAGA: threadId z URL Gmaila ≠ Gmail API threadId
// Dlatego pobieramy wątek WYŁĄCZNIE przez messageId (który działa w Gmail API)
function fetchThreadFull(threadId, messageId) {
  try {
    Logger.log('DEBUG fetchThreadFull typeof Gmail = ' + (typeof Gmail));

    // Walidacja: wymagamy messageId, threadId jest tylko informacyjne (z UI)
    if (!messageId || messageId.trim() === '') {
      Logger.log('fetchThreadFull: messageId jest pusty. threadId z UI: ' + (threadId || 'brak'));
      return {
        success: false,
        error: 'messageId jest pusty – nie można pobrać wątku.'
      };
    }

    Logger.log('fetchThreadFull: Próba pobrania wątku po messageId: ' + messageId +
               ', threadId z UI: ' + (threadId || 'brak'));

    try {
      Logger.log('fetchThreadFull: Gmail.Users.Messages.get dla messageId: ' + messageId);

      // 1) Pobierz wiadomość przez Gmail API (akceptuje hex ID z DOM)
      const message = Gmail.Users.Messages.get('me', messageId, { format: 'full' });

      if (!message || !message.threadId) {
        Logger.log('fetchThreadFull: Gmail API nie zwrócił threadId dla messageId: ' + messageId);
        return {
          success: false,
          error: 'Gmail API nie zwrócił threadId dla podanego messageId.'
        };
      }

      const apiThreadId = message.threadId;
      Logger.log('fetchThreadFull: Pobrany apiThreadId z Gmail API: ' + apiThreadId);

      // 2) Pobierz cały wątek używając threadId z API (NIE z URL)
      const thread = Gmail.Users.Threads.get('me', apiThreadId);

      if (thread && thread.messages) {
        Logger.log('fetchThreadFull: Wątek pobrany, liczba wiadomości: ' + thread.messages.length);

        const messages = thread.messages.map(msg => {
          const payload = msg.payload;
          const headers = payload.headers || [];

          const getHeader = (name) => {
            const header = headers.find(h => h.name.toLowerCase() === name.toLowerCase());
            return header ? header.value : '';
          };

          let plainBody = '';

          // Najpierw sprawdź body.data
          if (payload.body && payload.body.data) {
            try {
              plainBody = Utilities.newBlob(Utilities.base64DecodeWebSafe(payload.body.data)).getDataAsString();
            } catch (e) {
              Logger.log('Błąd dekodowania body.data: ' + e);
            }
          }

          // Jeśli nie ma body.data, szukaj w parts
          if (!plainBody && payload.parts) {
            for (let i = 0; i < payload.parts.length; i++) {
              const part = payload.parts[i];
              if (part.mimeType === 'text/plain' && part.body && part.body.data) {
                try {
                  plainBody = Utilities.newBlob(Utilities.base64DecodeWebSafe(part.body.data)).getDataAsString();
                  break;
                } catch (e) {
                  Logger.log('Błąd dekodowania part: ' + e);
                }
              }
            }
          }

          return {
            messageId: msg.id,
            threadId: msg.threadId,
            subject: getHeader('Subject'),
            from: getHeader('From'),
            to: getHeader('To'),
            date: getHeader('Date'),
            snippet: msg.snippet || '',
            plainBody: plainBody
          };
        });

        const summaryEntries = messages.map(m => ({
          id: m.messageId,
          from: m.from,
          subject: m.subject,
          plainChars: m.plainBody ? m.plainBody.length : 0,
          snippetChars: m.snippet ? m.snippet.length : 0
        }));
        logFetchedMessagesSummary('FETCH_THREAD', {
          threadId: threadId || apiThreadId,
          messageId: messageId,
          messages: summaryEntries
        });

        return {
          // Zwracamy oba identyfikatory: UI threadId (z URL) oraz apiThreadId z Gmail API
          success: true,
          threadId: threadId || apiThreadId, // dla spójności z currentState.threadId
          apiThreadId: apiThreadId,
          messageCount: messages.length,
          messages: messages
        };
      }

      return {
        success: false,
        error: 'Gmail API nie zwrócił wiadomości dla wątku (apiThreadId: ' + apiThreadId + ').'
      };

    } catch (gmailApiError) {
      Logger.log('fetchThreadFull: Błąd Gmail API (Messages/Threads): ' + gmailApiError.toString());
      return {
        success: false,
        error: 'Nie można pobrać wątku po messageId: ' + gmailApiError.toString()
      };
    }

  } catch (error) {
    Logger.log('Błąd fetchThreadFull: ' + error.toString());
    return {
      success: false,
      error: error.toString()
    };
  }
}

// Endpoint doPOST - odbiera logi z rozszerzenia Chrome + ETAP 2: Gmail API calls
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    
    // ========== ETAP 2*: Gmail API Routing ==========
    if (data.action) {
      let result;
      
      // ETAP 2*: fetch-message-simple teraz używa pełnej wiadomości
      if (data.action === 'fetch-message-simple' || data.action === 'fetch-message-full') {
        result = fetchMessageFull(data.messageId, data.threadId);
      } else if (data.action === 'get-thread-metadata') {
        // Thread Intelligence: szybkie sprawdzenie messageCount (20-50ms)
        result = getThreadMetadata(data.messageId);
    } else if (data.action === 'fetch-thread-full') {
        result = fetchThreadFull(data.threadId, data.messageId);
      } else if (data.action === 'analyze-message') {
        // ETAP 4: Analiza LLM (Mock w 4.0, prawdziwy Cloud Run w 4.1)
        result = analyzeMessage(data.messageId);
    } else if (data.action === 'match-account') {
      result = matchAccountCandidate(data.candidate || {});
    } else if (data.action === 'match-contact') {
      result = matchContactCandidate(data.candidate || {});
      } else {
        result = {
          success: false,
          error: 'Nieznana akcja: ' + data.action
        };
      }
      
      return ContentService.createTextOutput(JSON.stringify(result))
        .setMimeType(ContentService.MimeType.JSON);
    }
    
    // ========== ETAP 1: Logowanie (jeśli brak action) ==========
    // Walidacja danych
    if (!data.source || !data.message) {
      return ContentService.createTextOutput(JSON.stringify({
        success: false,
        error: 'Brak wymaganych pól: source, message'
      })).setMimeType(ContentService.MimeType.JSON);
    }
    
    // Zapisz log do Drive
    const result = saveLogToDrive({
      source: data.source,
      message: data.message,
      level: data.level || 'INFO',
      timestamp: data.timestamp || new Date().toISOString(),
      additionalData: data.additionalData || {}
    });
    
    return ContentService.createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);
      
  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({
      success: false,
      error: error.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

// Funkcja testowa - możesz wywołać z edytora GAS
function testLogging() {
  const testData = {
    source: 'TEST',
    message: 'To jest test logowania',
    level: 'INFO'
  };
  
  const result = saveLogToDrive(testData);
  Logger.log('Wynik testu: ' + JSON.stringify(result));
}

// Funkcja testowa - test Gmail API
function testGmailAPI() {
  // Test pobrania wiadomości
  const threads = GmailApp.getInboxThreads(0, 1);
  if (threads.length > 0) {
    const messages = threads[0].getMessages();
    const message = messages[0];
    
    Logger.log('Message ID: ' + message.getId());
    Logger.log('Subject: ' + message.getSubject());
    Logger.log('From: ' + message.getFrom());
  }
}

// ========== ETAP 4.1: LLM Analysis (Cloud Run + Gemini 2.5 Pro) ==========

// Cloud Run endpoint URL (zaktualizuj po deployment)
const CLOUD_RUN_URL = "https://gmail-crm-llm-backend-183771205172.europe-central2.run.app/analyze";

/**
 * Wykonuje matching z Zoho CRM dla wyników analizy LLM
 * Używane zarówno dla cache hit jak i nowej analizy
 * 
 * @param {string} messageId - ID wiadomości Gmail
 * @param {Object} filteredAnalysis - Wynik analizy po filtrach ignore
 * @param {Object} metadata - Metadata z Cloud Run
 * @returns {Object} - { success: true, analysis: {...}, metadata: {...} }
 */
function performZohoMatching(messageId, filteredAnalysis, metadata) {
  Logger.log('[GAS] 🔍 Matching z Zoho CRM START...');
  const matchStart = Date.now();
  
  const resultMetadata = Object.assign({}, metadata || {});
  resultMetadata.ignoredCompanies = filteredAnalysis.ignoredCompanies || 0;
  resultMetadata.ignoredContacts = filteredAnalysis.ignoredContacts || 0;
  
  // Match firms
  const enrichedCompanies = (filteredAnalysis.companies || []).map(function(company, idx) {
    Logger.log('[GAS] 🏢 Matching firma ' + (idx + 1) + '/' + (filteredAnalysis.companies || []).length + ': ' + (company.company_name || 'bez nazwy'));
    try {
      const match = matchAccountCandidate(company);
      if (match && match.existsInCrm) {
        company.existsInCrm = true;
        company.crmId = match.crmId;
        company.crmData = match.crmData;
        company.matchSource = match.matchSource;
        company.needsEnrichment = match.needsEnrichment;
        company.category = match.needsEnrichment ? 'existing_enrichable' : 'existing_complete';
        
        Logger.log('[GAS] ✅ Firma matched: existsInCrm=true' + 
                   ', matchSource=' + match.matchSource + 
                   ', needsEnrichment=' + match.needsEnrichment +
                   ', category=' + company.category);
      } else {
        const possible = match && Array.isArray(match.possibleCrmMatches) ? match.possibleCrmMatches : [];
        company.existsInCrm = false;
        company.crmId = null;
        company.crmData = null;
        company.matchSource = null;
        company.needsEnrichment = false;
        company.possibleCrmMatches = possible;

        const hasNip = Boolean(company.nip);
        if (possible.length) {
          company.category = 'possible_match';
          Logger.log('[GAS] 🟣 Firma possible_match (hinty=' + possible.length + ')');
        } else {
          // wg polityki: bez NIP firma nie jest "complete"
          company.category = hasNip ? 'new_complete' : 'new_partial';
          Logger.log('[GAS] ℹ️ Firma nie znaleziona w CRM (by NIP), category=' + company.category);
        }
      }
    } catch (matchError) {
      Logger.log('[GAS] ⚠️ Błąd matchingu firmy: ' + matchError.toString());
      company.existsInCrm = false;
      company.crmId = null;
      company.crmData = null;
      company.matchSource = null;
      company.needsEnrichment = false;
      company.category = 'new_partial';
    }
    return company;
  });
  
  // Match contacts
  const enrichedContacts = (filteredAnalysis.contacts || []).map(function(contact, idx) {
    Logger.log('[GAS] 👤 Matching kontakt ' + (idx + 1) + '/' + (filteredAnalysis.contacts || []).length + ': ' + 
               (contact.first_name || '') + ' ' + (contact.last_name || ''));
    try {
      const match = matchContactCandidate(contact);
      if (match && match.existsInCrm) {
        contact.existsInCrm = true;
        contact.crmId = match.crmId;
        contact.crmData = match.crmData;
        contact.matchSource = match.matchSource;
        contact.needsEnrichment = match.needsEnrichment;
        contact.category = match.needsEnrichment ? 'existing_enrichable' : 'existing_complete';
        
        Logger.log('[GAS] ✅ Kontakt matched: existsInCrm=true' + 
                   ', matchSource=' + match.matchSource + 
                   ', needsEnrichment=' + match.needsEnrichment +
                   ', category=' + contact.category);
      } else {
        contact.existsInCrm = false;
        contact.crmId = null;
        contact.crmData = null;
        contact.matchSource = null;
        contact.needsEnrichment = false;
        var hasBasicData = contact.first_name && contact.last_name && contact.email;
        contact.category = hasBasicData ? 'new_complete' : 'new_partial';
        Logger.log('[GAS] ℹ️ Kontakt nie znaleziony w CRM (nowy rekord), category=' + contact.category);
      }
    } catch (matchError) {
      Logger.log('[GAS] ⚠️ Błąd matchingu kontaktu: ' + matchError.toString());
      contact.existsInCrm = false;
      contact.crmId = null;
      contact.crmData = null;
      contact.matchSource = null;
      contact.needsEnrichment = false;
      contact.category = 'new_partial';
    }
    return contact;
  });
  
  const matchTime = Date.now() - matchStart;
  Logger.log('[GAS] 🔍 Matching COMPLETE: ' + matchTime + 'ms');
  
  return {
    success: true,
    messageId: messageId,
    analysis: {
      companies: enrichedCompanies,
      contacts: enrichedContacts
    },
    metadata: resultMetadata,
    analyzedAt: new Date().toISOString()
  };
}

/**
 * ETAP 4.1: Endpoint do analizy wiadomości przez LLM (Cloud Run + Gemini 2.5 Pro)
 * 
 * OPTYMALIZACJA: Najpierw sprawdza cache w Firestore (przez /check-cache endpoint).
 * Jeśli cache hit - nie pobiera emaila z Gmail, tylko wykonuje matching z Zoho.
 * Jeśli cache miss - pobiera email i wywołuje /analyze.
 * 
 * @param {string} messageId - ID wiadomości Gmail
 * @param {string} threadId - ID wątku Gmail (opcjonalnie)
 * @returns {Object} - { success: true, analysis: {...} }
 */
function analyzeMessage(messageId, threadId) {
  try {
    if (!messageId || messageId.trim() === '') {
      return {
        success: false,
        error: 'messageId jest pusty'
      };
    }
    
    Logger.log('[GAS] 🤖 analyzeMessage START (Cloud Run): ' + messageId);
    
    // ========== KROK 1: Sprawdź cache w Firestore ZANIM pobierzemy email ==========
    const checkCacheUrl = CLOUD_RUN_URL.replace('/analyze', '/check-cache');
    Logger.log('[GAS] 🔍 Sprawdzam cache w Firestore: ' + checkCacheUrl);
    
    try {
      const cacheCheckOptions = {
        method: 'post',
        contentType: 'application/json',
        payload: JSON.stringify({ messageId: messageId }),
        muteHttpExceptions: true
      };
      
      const cacheResponse = UrlFetchApp.fetch(checkCacheUrl, cacheCheckOptions);
      const cacheCode = cacheResponse.getResponseCode();
      
      if (cacheCode === 200) {
        const cacheResult = JSON.parse(cacheResponse.getContentText());
        
        if (cacheResult.success && cacheResult.cached) {
          Logger.log('[GAS] 💾 CACHE HIT! Zwracam wynik z Firestore bez pobierania emaila');
          Logger.log('[GAS] Original analyzed at: ' + (cacheResult.metadata?.originalAnalyzedAt || 'unknown'));
          
          // Mamy wynik z cache - teraz musimy wykonać matching z Zoho
          const analysisPayload = cacheResult.analysis || {};
          const sourceCompanies = Array.isArray(analysisPayload.companies) ? analysisPayload.companies : [];
          const sourceContacts = Array.isArray(analysisPayload.contacts) ? analysisPayload.contacts : [];
          
          Logger.log('[GAS] Cache analysis: ' + sourceCompanies.length + ' companies, ' + sourceContacts.length + ' contacts');
          
          // Zastosuj filtry ignore
          const ignoreRules = loadIgnoreRules();
          const filteredAnalysis = applyIgnoreFilters(analysisPayload, ignoreRules);
          Logger.log('[GAS] 🚫 Ignore filters: firmy=' + filteredAnalysis.ignoredCompanies + ', kontakty=' + filteredAnalysis.ignoredContacts);
          
          // Wykonaj matching z Zoho CRM
          return performZohoMatching(messageId, filteredAnalysis, cacheResult.metadata || {});
        } else {
          Logger.log('[GAS] ❌ CACHE MISS - kontynuuję z pełną analizą');
        }
      } else {
        Logger.log('[GAS] ⚠️ Cache check failed (HTTP ' + cacheCode + '), kontynuuję z pełną analizą');
      }
    } catch (cacheError) {
      Logger.log('[GAS] ⚠️ Cache check error: ' + cacheError.toString() + ', kontynuuję z pełną analizą');
    }
    
    // ========== KROK 2: Cache miss - pobierz email i wywołaj analizę ==========
    Logger.log('[GAS] 📧 Pobieram wiadomość z Gmail...');
    
    // Pobierz pełną wiadomość (format RAW dla pełnego kontekstu)
    const message = GmailApp.getMessageById(messageId);
    if (!message) {
      return {
        success: false,
        error: 'Nie znaleziono wiadomości o ID: ' + messageId
      };
    }
    
    // Pobierz pełną treść wiadomości
    // Używamy getPlainBody() + getFrom() + getSubject() dla lepszego kontekstu
    const emailContent = 
      'Subject: ' + message.getSubject() + '\n' +
      'From: ' + message.getFrom() + '\n' +
      'Date: ' + message.getDate() + '\n' +
      'To: ' + message.getTo() + '\n\n' +
      message.getPlainBody();
    
    Logger.log('[GAS] 📧 Email content length: ' + emailContent.length + ' chars');
    
    // Przygotuj payload dla Cloud Run
    const payload = {
      messageId: messageId,
      threadId: threadId || message.getThread().getId(),
      fullRawEmail: emailContent
    };
    
    // Wywołaj Cloud Run
    Logger.log('[GAS] 🚀 Calling Cloud Run /analyze: ' + CLOUD_RUN_URL);
    
    const options = {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true // Obsługujemy błędy HTTP manualnie
    };
    
    const response = UrlFetchApp.fetch(CLOUD_RUN_URL, options);
    const responseCode = response.getResponseCode();
    const responseText = response.getContentText();
    
    Logger.log('[GAS] 📡 Cloud Run response code: ' + responseCode);
    
    if (responseCode !== 200) {
      Logger.log('[GAS] ❌ Cloud Run error: ' + responseText);
      return {
        success: false,
        error: 'Cloud Run error (HTTP ' + responseCode + '): ' + responseText
      };
    }
    
    // Parse odpowiedź z Cloud Run
    const result = JSON.parse(responseText);
    
    if (!result.success) {
      Logger.log('[GAS] ❌ Cloud Run returned error: ' + result.error);
      return {
        success: false,
        error: result.error
      };
    }
    
    const analysisPayload = result.analysis || {};
    const sourceCompanies = Array.isArray(analysisPayload.companies) ? analysisPayload.companies : [];
    const sourceContacts = Array.isArray(analysisPayload.contacts) ? analysisPayload.contacts : [];
    
    // Loguj czy wynik był z Firestore cache (fallback jeśli /check-cache nie zadziałał)
    const isCached = result.metadata && result.metadata.cached;
    if (isCached) {
      Logger.log('[GAS] 💾 Cloud Run /analyze zwrócił wynik z Firestore CACHE (fallback)');
      Logger.log('[GAS] Original analyzed at: ' + (result.metadata.originalAnalyzedAt || 'unknown'));
    } else {
      Logger.log('[GAS] 🆕 Cloud Run wykonał NOWĄ analizę Gemini');
    }
    
    Logger.log('[GAS] ✅ analyzeMessage COMPLETE (Cloud Run): ' + messageId);
    Logger.log('[GAS] Analysis: ' + 
      sourceCompanies.length + ' companies, ' + 
      sourceContacts.length + ' contacts');
    Logger.log('[GAS] Processing time: ' + (result.metadata ? result.metadata.processingTimeMs : '?') + 'ms');
    
    logGeminiJsonResult(messageId, analysisPayload, result.metadata || {});
    
    // ========== Filtry IGNORE po stronie GAS ==========
    const ignoreRules = loadIgnoreRules();
    const filteredAnalysis = applyIgnoreFilters(analysisPayload, ignoreRules);
    Logger.log('[GAS] 🚫 Ignore filters: firmy=' + filteredAnalysis.ignoredCompanies + ', kontakty=' + filteredAnalysis.ignoredContacts);
    
    // ========== Użyj wspólnej funkcji do matchingu ==========
    return performZohoMatching(messageId, filteredAnalysis, result.metadata);
    
  } catch (error) {
    Logger.log('[GAS] ❌ Błąd analyzeMessage: ' + error.toString());
    return {
      success: false,
      error: error.toString()
    };
  }
}
