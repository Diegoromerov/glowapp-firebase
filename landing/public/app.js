(() => {
  'use strict';
  const configUrl = '/landing.config.json';
  let config;
  let apiBase;
  const dialog = document.querySelector('#lead-dialog');
  const form = document.querySelector('#lead-form');
  const status = document.querySelector('.form-status');
  const roles = { client: ['Conoce las novedades y encuentra tu próximo servicio.', 'client'], professional: ['Solicita ingreso a una comunidad de profesionales por nodos.', 'professional'], salon: ['Cuéntanos de tu salón y conecta con nuevas oportunidades.', 'salon'] };

  async function init() {
    const response = await fetch(configUrl, { cache: 'no-cache' });
    config = await response.json();
    const env = location.hostname.includes('staging') ? 'staging' : ['localhost', '127.0.0.1'].includes(location.hostname) ? 'development' : 'production';
    apiBase = config.apiBaseUrl[env];
    document.querySelector('#privacy-link').href = `${apiBase}/privacy-policy.html`;
    if (config.turnstileSiteKey) {
      await new Promise((resolve, reject) => {
        const script = document.createElement('script'); script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'; script.async = true; script.defer = true; script.onload = resolve; script.onerror = reject; document.head.append(script);
      });
    }
    document.querySelectorAll('[data-button]').forEach(button => button.addEventListener('click', () => activateButton(button.dataset.button)));
    document.querySelector('.dialog-close').addEventListener('click', () => dialog.close());
    form.contactType.addEventListener('change', updateContact);
    form.addEventListener('submit', submitLead);
  }

  function activateButton(id) {
    const item = config.buttons.find(button => button.id === id);
    if (!item) return;
    if (item.mode === 'redirect' && item.redirectUrl) { location.assign(item.redirectUrl); return; }
    openForm(item.role);
  }

  function openForm(role) {
    const [description] = roles[role] || roles.client;
    form.reset(); status.textContent = '';
    form.role.value = role;
    document.querySelector('#form-title').textContent = role === 'salon' ? 'Hablemos de tu salón' : role === 'professional' ? 'Crezcamos en comunidad' : 'Encuentra tu próximo glow';
    document.querySelector('#form-description').textContent = description;
    document.querySelector('.salon-only').hidden = role !== 'salon';
    document.querySelector('.professional-only').hidden = role !== 'professional';
    document.querySelector('.client-only').hidden = role === 'salon';
    form.businessName.required = role === 'salon';
    form.neighborhood.required = role !== 'salon';
    const slot = document.querySelector('#turnstile-slot'); slot.replaceChildren();
    if (config.turnstileSiteKey && window.turnstile) {
      window.turnstile.render(slot, { sitekey: config.turnstileSiteKey, callback: token => { let field = form.querySelector('[name="cf-turnstile-response"]'); if (!field) { field = document.createElement('input'); field.type = 'hidden'; field.name = 'cf-turnstile-response'; form.append(field); } field.value = token; }, 'expired-callback': () => { const field = form.querySelector('[name="cf-turnstile-response"]'); if (field) field.value = ''; } });
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
    if (!turnstileToken && config.turnstileSiteKey) { status.textContent = 'Completa la verificación de seguridad.'; return; }
    if (!config.turnstileSiteKey) { status.textContent = 'El formulario aún no está habilitado. Vuelve pronto.'; return; }
    status.textContent = '';
    const submit = form.querySelector('.submit'); submit.disabled = true; submit.textContent = 'Enviando…';
    try {
      const response = await fetch(`${apiBase}/api/public/leads`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
      if (response.status === 202) { status.textContent = '¡Gracias! Recibimos tu solicitud.'; form.reset(); return; }
      if (response.status === 429) { status.textContent = 'Recibimos muchas solicitudes desde esta conexión. Intenta más tarde.'; return; }
      if (response.status === 503) { status.textContent = 'El formulario estará disponible pronto. Escríbenos más tarde.'; return; }
      status.textContent = response.status === 400 ? 'Revisa tus datos y completa la verificación de seguridad.' : 'No pudimos enviar tu solicitud. Intenta de nuevo.';
    } catch { status.textContent = 'No fue posible conectar. Revisa tu conexión e intenta de nuevo.'; }
    finally { submit.disabled = false; submit.innerHTML = 'Enviar solicitud <span>↗</span>'; }
  }
  init().catch(() => { document.querySelectorAll('[data-button]').forEach(button => { button.disabled = true; }); });
})();
