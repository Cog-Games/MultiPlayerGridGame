function getCurrentLocation() {
  try {
    if (typeof window !== 'undefined' && window.location) {
      return window.location;
    }
  } catch (_) {
    // Ignore non-browser contexts.
  }
  return { search: '', hash: '' };
}

export function getUrlParamValue(keys, location = getCurrentLocation()) {
  const keyList = Array.isArray(keys) ? keys : [keys];

  const readFromParams = (source) => {
    try {
      const params = new URLSearchParams(source || '');
      for (const key of keyList) {
        const value = params.get(key);
        if (value && String(value).trim()) {
          return String(value).trim();
        }
      }
    } catch (_) {
      // Ignore malformed query strings.
    }
    return null;
  };

  const fromSearch = readFromParams(location.search || '');
  if (fromSearch) return fromSearch;

  try {
    const hash = String(location.hash || '');
    const queryStart = hash.indexOf('?');
    if (queryStart >= 0) {
      return readFromParams(hash.slice(queryStart + 1));
    }
  } catch (_) {
    // Ignore malformed hash strings.
  }

  return null;
}

export function getChildIdFromUrl(location = getCurrentLocation()) {
  return getUrlParamValue(['child', 'childId'], location);
}

export function getProlificPidFromUrl(location = getCurrentLocation()) {
  return getUrlParamValue(['PROLIFIC_PID', 'prolific_pid'], location);
}

export function getParticipantIdFromUrl(location = getCurrentLocation()) {
  return getChildIdFromUrl(location) || getProlificPidFromUrl(location);
}

export function parseDob(dob) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dob || '').trim());
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  if (year < 1900 || month < 1 || month > 12 || day < 1 || day > 31) return null;

  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }

  return { year, month, day, date };
}

export function calculateAgeFromDob(dob, referenceDate = new Date()) {
  const parsed = parseDob(dob);
  if (!parsed) return null;

  const ref = new Date(
    referenceDate.getFullYear(),
    referenceDate.getMonth(),
    referenceDate.getDate()
  );
  const birth = parsed.date;

  if (birth > ref) return null;

  let years = ref.getFullYear() - birth.getFullYear();
  let months = ref.getMonth() - birth.getMonth();
  let days = ref.getDate() - birth.getDate();

  if (days < 0) {
    months -= 1;
    days += new Date(ref.getFullYear(), ref.getMonth(), 0).getDate();
  }

  if (months < 0) {
    years -= 1;
    months += 12;
  }

  const birthUtc = Date.UTC(parsed.year, parsed.month - 1, parsed.day);
  const refUtc = Date.UTC(ref.getFullYear(), ref.getMonth(), ref.getDate());
  const totalDays = Math.floor((refUtc - birthUtc) / 86400000);

  return {
    participantDob: `${String(parsed.year).padStart(4, '0')}-${String(parsed.month).padStart(2, '0')}-${String(parsed.day).padStart(2, '0')}`,
    participantAgeReferenceDate: `${ref.getFullYear()}-${String(ref.getMonth() + 1).padStart(2, '0')}-${String(ref.getDate()).padStart(2, '0')}`,
    participantAgeYears: years,
    participantAgeMonths: months,
    participantAgeDays: days,
    participantAgeTotalDays: totalDays
  };
}
