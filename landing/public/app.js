(() => {
  'use strict';
  const configUrl = '/landing.config.json';
  let config;
  let apiBase;
  let env;
  let turnstileSiteKey;
  let configError = false;
  let turnstileError = false;
  let configReady = false;
  const dialog = document.querySelector('#lead-dialog');
  const form = document.querySelector('#lead-form');
  const status = document.querySelector('.form-status');
  const roles = { client: ['Conoce las novedades y encuentra tu pr\u00f3ximo servicio.', 'client'], professional: ['Solicita ingreso a una comunidad de profesionales por nodos.', 'professional'], salon: ['Cu\u00e9ntanos de tu sal\u00f3n y conecta con nuevas oportunidades.', 'salon'] };

  const analyticsEvents = [];
  let analyticsReady = false;

  function initAnalytics() {
    if (!config.analytics) return;
    if (config.analytics.plausibleDomain) {
      const script = document.createElement('script');
      script.defer = true;
      script.dataset.domain = config.analytics.plausibleDomain;
      script.dataset.apiHost = config.analytics.plausibleApiHost || 'https://plausible.io';
      script.src = (config.analytics.plausibleApiHost || 'https://plausible.io') + '/js/script.js';
      document.head.appendChild(script);
    }
    if (config.analytics.ga4MeasurementId) {
      window.dataLayer = window.dataLayer || [];
      function gtag() { window.dataLayer.push(arguments); }
      window.gtag = gtag;
      gtag('js', new Date());
      gtag('config', config.analytics.ga4MeasurementId);
      const script = document.createElement('script');
      script.async = true;
      script.src = 'https://www.googletagmanager.com/gtag/js?id=' + config.analytics.ga4MeasurementId;
      document.head.appendChild(script);
    }
    analyticsReady = true;
    analyticsEvents.forEach(([event, props]) => trackEvent(event, props));
    analyticsEvents.length = 0;
  }

  function trackEvent(event, props = {}) {
    const payload = { event, ...props, timestamp: new Date().toISOString(), env: env || 'unknown' };
    if (analyticsReady) {
      if (window.plausible) window.plausible(event, { props });
      if (window.gtag) window.gtag('event', event, props);
    } else {
      analyticsEvents.push([event, props]);
    }
    console.debug('[analytics]', payload);
  }

  function connectListeners() {
    document.querySelectorAll('[data-button]').forEach(button => button.addEventListener('click', () => activateButton(button.dataset.button)));
    document.querySelector('.dialog-close').addEventListener('click', () => dialog.close());
    form.contactType.addEventListener('change', updateContact);
    form.addEventListener('submit', submitLead);
  }

  async function loadTurnstile() {
    if (!turnstileSiteKey) return;
    try {
      await new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
        script.async = true;
        script.defer = true;
        script.onload = resolve;
        script.onerror = reject;
        document.head.append(script);
      });
    } catch (err) {
      console.warn('[landing] Turnstile no cargó:', err.message);
      turnstileSiteKey = '';
      turnstileError = true;
    }
  }

  async function init() {
    connectListeners();
    try {
      const response = await fetch(configUrl, { cache: 'no-cache' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      config = await response.json();
    } catch (err) {
      console.warn('[landing] Config no cargó:', err.message);
      config = {};
      configError = true;
      return;
    }
    const hostname = location.hostname;
    env = config.domainEnvMap?.[hostname];
    if (!env) env = hostname.includes('staging') ? 'staging' : hostname.includes('production') ? 'production' : 'development';
    configReady = true;
    apiBase = config.apiBaseUrl?.[env];
    turnstileSiteKey = config.turnstileSiteKey?.[env] || '';
    document.querySelector('#privacy-link').href = config.privacyUrl?.[env] || `${apiBase}/privacy-policy.html`;

    if (config.analytics?.autoInit) initAnalytics();

    await loadTurnstile();
  }

  function activateButton(id) {
    if (!configReady) {
      openForm(id === 'profesional' ? 'professional' : id === 'salon' ? 'salon' : 'client');
      return;
    }
    const item = config.buttons.find(button => button.id === id);
    if (!item) { openForm(id === 'profesional' ? 'professional' : id === 'salon' ? 'salon' : 'client'); return; }
    trackEvent('button_click', { button_id: id, role: item.role });
    if (item.mode === 'redirect' && item.redirectUrl) { location.assign(item.redirectUrl); return; }
    openForm(item.role);
  }

  function openForm(role) {
    const [description] = roles[role] || roles.client;
    form.reset(); status.textContent = '';
    form.role.value = role;
    document.querySelector('#form-title').textContent = role === 'salon' ? 'Hablemos de tu sal\u00f3n' : role === 'professional' ? 'Crezcamos en comunidad' : 'Encuentra tu pr\u00f3ximo glow';
    document.querySelector('#form-description').textContent = description;
    document.querySelector('.salon-only').hidden = role !== 'salon';
    document.querySelector('.professional-only').hidden = role !== 'professional';
    document.querySelector('.client-only').hidden = role === 'salon';
    form.businessName.required = role === 'salon';
    form.neighborhood.required = role !== 'salon';
    const slot = document.querySelector('#turnstile-slot'); slot.replaceChildren();
    if (turnstileSiteKey && window.turnstile) {
      try {
        window.turnstile.render(slot, { sitekey: turnstileSiteKey, callback: token => { let field = form.querySelector('[name="cf-turnstile-response"]'); if (!field) { field = document.createElement('input'); field.type = 'hidden'; field.name = 'cf-turnstile-response'; form.append(field); } field.value = token; }, 'expired-callback': () => { const field = form.querySelector('[name="cf-turnstile-response"]'); if (field) field.value = ''; } });
      } catch (err) {
        console.warn('[landing] Turnstile no se pudo renderizar:', err.message);
        turnstileError = true;
        turnstileSiteKey = '';
      }
    } else if (turnstileSiteKey) {
      turnstileError = true;
    }
    updateContact();
    dialog.showModal();
    form.name.focus();
  }

  function updateContact() {
    const whatsapp = form.contactType.value === 'whatsapp';
    form.contact.type = whatsapp ? 'tel' : 'email';
    form.contact.autocomplete = whatsapp ? 'tel' : 'email';
    form.contact.placeholder = whatsapp ? '+57 300 000 0000' : 'tu@correo.com';
    form.contact.inputMode = whatsapp ? 'tel' : 'email';
  }

  async function submitLead(event) {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const tokenField = form.querySelector('[name="cf-turnstile-response"]');
    const turnstileToken = tokenField?.value || '';
    const data = new FormData(form);
    const payload = {
      role: data.get('role'), name: data.get('name').trim(), businessName: data.get('businessName').trim() || undefined,
      contactType: data.get('contactType'), contact: data.get('contact').trim(), city: data.get('city').trim(),
      neighborhood: data.get('neighborhood').trim() || undefined, referralCode: data.get('referralCode').trim() || undefined,
      consent: data.get('consent') === 'on', consentTextVersion: config.consentTextVersion, turnstileToken,
      website: data.get('website') || '', utm: { source: new URLSearchParams(location.search).get('utm_source') || '', medium: new URLSearchParams(location.search).get('utm_medium') || '', campaign: new URLSearchParams(location.search).get('utm_campaign') || '' }
    };
    if (configError) { status.textContent = 'No pudimos cargar la configuración. Recarga la página.'; return; }
    if (turnstileError) { status.textContent = 'No pudimos cargar la verificación de seguridad. Recarga la página o desactiva el bloqueador.'; return; }
    if (!turnstileToken && turnstileSiteKey) { status.textContent = 'Completa la verificación de seguridad.'; return; }
    if (!turnstileSiteKey) { status.textContent = 'El formulario aún no está habilitado.'; return; }
    status.textContent = '';
    const submit = form.querySelector('.submit'); submit.disabled = true; submit.textContent = 'Enviando...';
    const start = performance.now();
    try {
      const response = await fetch(apiBase + '/api/public/leads', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
      const latency = Math.round(performance.now() - start);
      if (response.status === 202) {
        trackEvent('lead_submit', { role: payload.role, latency_ms: latency });
        status.textContent = '\u00a1Gracias! Recibimos tu solicitud.'; form.reset(); return;
      }
      if (response.status === 429) { trackEvent('lead_error', { error: 'rate_limited', latency_ms: latency }); status.textContent = 'Recibimos muchas solicitudes desde esta conexi\u00f3n. Intenta m\u00e1s tarde.'; return; }
      if (response.status === 503) { trackEvent('lead_error', { error: 'service_unavailable', latency_ms: latency }); status.textContent = 'El formulario estar\u00e1 disponible pronto. Escr\u00edbenos m\u00e1s tarde.'; return; }
      trackEvent('lead_error', { error: response.status === 400 ? 'validation_failed' : 'unknown', status: response.status, latency_ms: latency });
      status.textContent = response.status === 400 ? 'Revisa tus datos y completa la verificación de seguridad.' : 'No pudimos enviar tu solicitud. Intenta de nuevo.';
    } catch (err) {
      trackEvent('lead_error', { error: 'network_error', message: err.message, latency_ms: Math.round(performance.now() - start) });
      status.textContent = 'No fue posible conectar. Revisa tu conexi\u00f3n e intenta de nuevo.';
    } finally { submit.disabled = false; submit.innerHTML = 'Enviar solicitud <span>\u2197</span>'; }
  }
  init().catch(err => {
    console.error('[landing] Error de inicialización:', err.message);
    configError = true;
  });
})();
