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
  const intro = document.querySelector('#intro');
  const introVideo = document.querySelector('#intro-video');
  const transitionVideo = document.querySelector('#transition-video');
  const staticPage = document.querySelector('#static');
  const roles = { client: ['Conoce las novedades y encuentra tu pr\u00f3ximo servicio.', 'client'], professional: ['Solicita ingreso a una comunidad de profesionales por nodos.', 'professional'], salon: ['Cu\u00e9ntanos de tu sal\u00f3n y conecta con nuevas oportunidades.', 'salon'] };

  function showLanding(state) {
    const showVideo = state === 'video';
    intro.hidden = !showVideo;
    intro.setAttribute('aria-hidden', String(!showVideo));
    staticPage.hidden = showVideo;
    document.body.classList.toggle('video-landing', showVideo);
    document.body.classList.toggle('static-landing', !showVideo);
  }

  function storageMediaUrl(path) {
    const url = new URL(`https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(config.firebase.storageBucket)}/o/${encodeURIComponent(path)}`);
    url.searchParams.set('alt', 'media');
    url.searchParams.set('key', config.firebase.apiKey);
    return url.toString();
  }

  function bufferedTo(video) {
    if (!video.buffered.length) return 0;
    return video.buffered.end(video.buffered.length - 1);
  }

  function updateIntroProgress() {
    const duration = introVideo.duration;
    const targetSeconds = Number.isFinite(duration) ? Math.min(duration, 1.5) : 1.5;
    const percent = Math.max(0, Math.min(100, Math.round(bufferedTo(introVideo) / targetSeconds * 100)));
    document.querySelector('#preload-progress').style.width = `${percent}%`;
    document.querySelector('.preload-track').setAttribute('aria-valuenow', String(percent));
  }

  function updateTransitionPreload() {
    if (Number.isFinite(transitionVideo.duration) && bufferedTo(transitionVideo) >= transitionVideo.duration - 0.2) {
      const button = document.querySelector('#start-interactive');
      button.disabled = false;
      button.textContent = 'Interactivo';
    }
  }

  function preloadTransitionVideo() {
    const button = document.querySelector('#start-interactive');
    const videoPath = config?.videoLanding?.transitionPath;
    if (!config?.firebase?.apiKey || !config.firebase.storageBucket || !videoPath) {
      button.textContent = 'Interactivo no disponible';
      return;
    }
    transitionVideo.muted = true;
    transitionVideo.preload = 'auto';
    transitionVideo.src = storageMediaUrl(videoPath);
    transitionVideo.load();
  }

  function renderLandingButtons(buttons = []) {
    const nav = document.querySelector('#static-buttons');
    nav.replaceChildren();
    buttons.forEach((item, index) => {
      if (!item || !['cliente', 'profesional', 'salon'].includes(item.id)) return;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `audience${index === 0 ? ' audience-primary' : ''}`;
      button.dataset.button = item.id;
      const icon = document.createElement('span');
      icon.className = 'audience-icon'; icon.setAttribute('aria-hidden', 'true');
      icon.textContent = item.id === 'cliente' ? '♡' : item.id === 'profesional' ? '✳' : '✦';
      const label = document.createElement('span'); label.textContent = item.label;
      const arrow = document.createElement('span'); arrow.className = 'arrow'; arrow.setAttribute('aria-hidden', 'true'); arrow.textContent = '↗';
      button.append(icon, label, arrow); nav.append(button);
    });
  }

  function startVideoLanding() {
    const firebase = config?.firebase;
    const videoPath = config?.videoLanding?.introPath;
    if (!firebase?.apiKey || !firebase?.storageBucket || !videoPath) { showLanding('static'); return; }
    intro.dataset.videoMode = 'intro';
    introVideo.muted = true;
    introVideo.defaultMuted = true;
    introVideo.loop = true;
    intro.classList.add('is-loading');
    introVideo.src = storageMediaUrl(videoPath);
    showLanding('video');
    introVideo.play().catch(() => {});
  }

  function startInteractiveVideo() {
    if (document.querySelector('#start-interactive').disabled) return;
    intro.dataset.videoMode = 'transition';
    intro.classList.add('is-transition');
    intro.setAttribute('aria-label', 'Video interactivo de GlowApp');
    introVideo.pause();
    transitionVideo.muted = false;
    transitionVideo.defaultMuted = false;
    transitionVideo.loop = false;
    transitionVideo.currentTime = 0;
    transitionVideo.play().catch(() => {
      if (intro.dataset.videoMode !== 'transition') return;
      intro.dataset.videoMode = 'intro';
      intro.classList.remove('is-transition');
      intro.setAttribute('aria-label', 'Introducción de GlowApp');
      transitionVideo.pause();
      transitionVideo.muted = true;
      introVideo.play().catch(() => {});
    });
  }

  function enterStaticLanding() {
    introVideo.pause();
    transitionVideo.pause();
    transitionVideo.muted = true;
    intro.classList.remove('is-transition');
    intro.dataset.videoMode = 'static';
    showLanding('static');
  }

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
    document.addEventListener('click', event => {
      const button = event.target.closest('[data-button]');
      if (button) activateButton(button.dataset.button);
    });
    document.querySelector('#start-interactive').addEventListener('click', startInteractiveVideo);
    document.querySelector('#skip-intro').addEventListener('click', enterStaticLanding);
    introVideo.addEventListener('progress', updateIntroProgress);
    introVideo.addEventListener('loadedmetadata', updateIntroProgress);
    introVideo.addEventListener('canplay', () => {
      if (intro.dataset.videoMode !== 'intro') return;
      intro.classList.remove('is-loading');
      updateIntroProgress();
      window.setTimeout(preloadTransitionVideo, 300);
    });
    introVideo.addEventListener('error', () => {
      console.warn('[landing] No se pudo cargar el video intro.');
      enterStaticLanding();
    });
    transitionVideo.addEventListener('progress', updateTransitionPreload);
    transitionVideo.addEventListener('loadedmetadata', updateTransitionPreload);
    transitionVideo.addEventListener('canplaythrough', updateTransitionPreload);
    transitionVideo.addEventListener('ended', () => {
      if (intro.dataset.videoMode === 'transition') enterStaticLanding();
    });
    transitionVideo.addEventListener('error', () => {
      if (intro.dataset.videoMode === 'transition') {
        console.warn('[landing] No se pudo reproducir el video interactivo.');
        enterStaticLanding();
      } else {
        document.querySelector('#start-interactive').textContent = 'Video interactivo no disponible';
      }
    });
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
      renderLandingButtons([
        { id: 'cliente', label: 'Quiero reservar' },
        { id: 'profesional', label: 'Soy profesional' },
        { id: 'salon', label: 'Tengo un salón' }
      ]);
      showLanding('static');
      return;
    }
    renderLandingButtons(config.buttons);
    startVideoLanding();
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
