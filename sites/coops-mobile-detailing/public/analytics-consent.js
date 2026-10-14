/* global document, HTMLElement, window */

(() => {
  const storageKey = 'coops_analytics_consent';
  const banner = document.querySelector('[data-analytics-consent]');
  const accept = document.querySelector('[data-analytics-accept]');
  const decline = document.querySelector('[data-analytics-decline]');
  const manage = document.querySelector('[data-analytics-manage]');

  if (!(banner instanceof HTMLElement)) return;

  const readDecision = () => {
    try {
      return window.localStorage.getItem(storageKey);
    } catch {
      return null;
    }
  };

  const writeDecision = (decision) => {
    try {
      window.localStorage.setItem(storageKey, decision);
    } catch {
      // Consent mode still applies for this page when storage is unavailable.
    }
  };

  const clearAnalyticsCookies = () => {
    for (const item of document.cookie.split(';')) {
      const name = item.split('=', 1)[0]?.trim();
      if (name === '_ga' || name?.startsWith('_ga_')) {
        document.cookie = `${name}=; Max-Age=0; Path=/; SameSite=Lax`;
      }
    }
  };

  const updateConsent = (decision) => {
    window.gtag?.('consent', 'update', {
      analytics_storage: decision,
      ad_storage: 'denied',
      ad_user_data: 'denied',
      ad_personalization: 'denied',
    });
  };

  const decide = (decision) => {
    writeDecision(decision);
    updateConsent(decision);
    if (decision === 'denied') clearAnalyticsCookies();
    banner.hidden = true;
    window.location.reload();
  };

  accept?.addEventListener('click', () => decide('granted'));
  decline?.addEventListener('click', () => decide('denied'));
  manage?.addEventListener('click', () => {
    banner.hidden = false;
    accept?.focus();
  });

  if (readDecision() !== 'granted' && readDecision() !== 'denied') {
    banner.hidden = false;
  }
})();
