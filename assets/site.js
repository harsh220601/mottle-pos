// Mottle POS — website interactions. No dependencies.
(() => {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Mobile menu
  const nav = document.querySelector('.nav');
  const menuBtn = document.querySelector('.menu-btn');
  if (nav && menuBtn) {
    menuBtn.addEventListener('click', () => {
      const open = nav.classList.toggle('open');
      menuBtn.setAttribute('aria-expanded', String(open));
    });
    nav.querySelectorAll('.nav-links a').forEach(a => a.addEventListener('click', () => {
      nav.classList.remove('open');
      menuBtn.setAttribute('aria-expanded', 'false');
    }));
  }

  // Dark nav while a dark section sits under it
  const darkSections = [...document.querySelectorAll('[data-dark-nav]')];
  const updateNav = () => {
    if (!nav) return;
    const y = (nav.offsetHeight || 52) + 2;
    const overDark = darkSections.some(s => {
      const r = s.getBoundingClientRect();
      return r.top <= y && r.bottom >= y;
    });
    nav.classList.toggle('dark', overDark);
  };

  // Reveal on scroll
  const revealIO = 'IntersectionObserver' in window ? new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (e.isIntersecting) { e.target.classList.add('in'); revealIO.unobserve(e.target); }
    });
  }, { rootMargin: '0px 0px -10% 0px', threshold: 0.08 }) : null;
  document.querySelectorAll('.reveal').forEach(el => revealIO ? revealIO.observe(el) : el.classList.add('in'));

  // Scroll-linked progress: hero iPad rises into place, iPhones fan open
  const hero = document.querySelector('.hero-device');
  const phones = document.querySelector('.phones');
  const clamp = v => Math.min(1, Math.max(0, v));
  let ticking = false;
  const onScroll = () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      const vh = window.innerHeight;
      if (hero && !reduceMotion) {
        const r = hero.getBoundingClientRect();
        hero.style.setProperty('--p', clamp((vh - r.top) / (vh * 0.75)).toFixed(3));
      }
      if (phones && !reduceMotion) {
        const r = phones.getBoundingClientRect();
        // 1 = stacked, 0 = fanned
        phones.style.setProperty('--f', (1 - clamp((vh - r.top) / (vh * 0.8))).toFixed(3));
      }
      updateNav();
      ticking = false;
    });
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll);
  onScroll();

  // Sticky product story: swap the screen to match the step in view
  const steps = [...document.querySelectorAll('.story-step')];
  const screens = [...document.querySelectorAll('.story-visual .screen img')];
  if (steps.length && 'IntersectionObserver' in window) {
    const storyIO = new IntersectionObserver(entries => {
      entries.forEach(e => {
        if (!e.isIntersecting) return;
        const i = steps.indexOf(e.target);
        steps.forEach((s, j) => s.classList.toggle('active', j === i));
        screens.forEach((img, j) => img.classList.toggle('active', j === i));
      });
    }, { rootMargin: '-45% 0px -45% 0px' });
    steps.forEach(s => storyIO.observe(s));
  }

  // Videos: play only while visible; never autoplay with Reduce Motion
  const videos = [...document.querySelectorAll('video[data-autoplay]')];
  if (reduceMotion) {
    videos.forEach(v => { v.removeAttribute('autoplay'); v.pause(); });
  } else if ('IntersectionObserver' in window) {
    const vidIO = new IntersectionObserver(entries => {
      entries.forEach(e => {
        const v = e.target;
        if (v.dataset.userPaused === 'true') return;
        if (e.isIntersecting) { v.play().catch(() => {}); } else { v.pause(); }
      });
    }, { threshold: 0.25 });
    videos.forEach(v => vidIO.observe(v));
  }

  // Film play/pause control
  document.querySelectorAll('.film').forEach(film => {
    const v = film.querySelector('video');
    const btn = film.querySelector('.film-toggle');
    if (!v || !btn) return;
    const sync = () => {
      const playing = !v.paused;
      btn.setAttribute('aria-label', playing ? 'Pause video' : 'Play video');
      btn.innerHTML = playing
        ? '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>'
        : '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.4-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"/></svg>';
    };
    btn.addEventListener('click', () => {
      if (v.paused) { v.dataset.userPaused = 'false'; v.play().catch(() => {}); }
      else { v.dataset.userPaused = 'true'; v.pause(); }
    });
    v.addEventListener('play', sync);
    v.addEventListener('pause', sync);
    sync();
  });

  // Native support form → submits to the Google Form in the background
  document.querySelectorAll('form[data-gform]').forEach(form => {
    const wrap = form.closest('.contact');
    const done = wrap.querySelector('.form-done');
    const errorEl = form.querySelector('.form-error');
    const button = form.querySelector('.send');
    const DEVICE = 'entry.1421374182';

    // Pre-select the visitor's device
    const ua = navigator.userAgent;
    const isIPad = /iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
    const guess = isIPad ? 'iPad' : /iPhone/.test(ua) ? 'iPhone' : null;
    if (guess) { const r = form.querySelector(`input[name="${DEVICE}"][value="${guess}"]`); if (r) r.checked = true; }

    // Allow ?topic=bug|question|feature from links
    const topics = { bug: 'Report a bug', question: 'Ask a question', feature: 'Suggest a feature' };
    const topic = topics[new URLSearchParams(location.search).get('topic')];
    if (topic) { const r = form.querySelector(`input[value="${topic}"]`); if (r) r.checked = true; }

    const clearInvalid = el => el.classList.remove('invalid');
    form.addEventListener('input', e => { clearInvalid(e.target); const p = e.target.closest('.pills'); if (p) clearInvalid(p); errorEl.hidden = true; });

    const validate = () => {
      const problems = [];
      const type = form.querySelector('input[name="entry.1389469550"]:checked');
      if (!type) { form.querySelector('[data-error-for="entry.1389469550"]').classList.add('invalid'); problems.push('choose what your message is about'); }
      const details = form.querySelector('#f-details');
      if (details.value.trim().length < 5) { details.classList.add('invalid'); problems.push('tell us what’s going on'); }
      const email = form.querySelector('#f-email');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.value.trim())) { email.classList.add('invalid'); problems.push('enter an email we can reply to'); }
      return problems;
    };

    form.addEventListener('submit', async e => {
      e.preventDefault();
      if (form.company.value) return; // bot
      const problems = validate();
      if (problems.length) {
        errorEl.textContent = 'Please ' + problems.join(', ') + '.';
        errorEl.hidden = false;
        const first = form.querySelector('.invalid input, .invalid, input.invalid, textarea.invalid');
        if (first) (first.matches('input,textarea') ? first : first.querySelector('input')).focus();
        return;
      }
      const data = new URLSearchParams();
      new FormData(form).forEach((v, k) => { if (k.startsWith('entry.') && String(v).trim()) data.append(k, String(v).trim()); });
      button.disabled = true; button.classList.add('loading');
      button.querySelector('.label').textContent = 'Sending…';
      try {
        await fetch(form.action, { method: 'POST', mode: 'no-cors', body: data });
        done.querySelector('[data-echo-email]').textContent = form.querySelector('#f-email').value.trim();
        form.hidden = true;
        wrap.querySelector('.contact-head').hidden = true;
        done.hidden = false;
        done.focus();
        wrap.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
      } catch (err) {
        errorEl.innerHTML = 'We couldn’t send that — check your connection and try again, or <a href="' + form.dataset.fallback + '" rel="noopener">use the Google Form</a>.';
        errorEl.hidden = false;
      } finally {
        button.disabled = false; button.classList.remove('loading');
        button.querySelector('.label').textContent = 'Send message';
      }
    });

    done.querySelector('.again').addEventListener('click', () => {
      const keep = ['#f-name', '#f-email', '#f-phone', '#f-version'].map(s => [s, form.querySelector(s).value]);
      form.reset();
      keep.forEach(([s, v]) => { form.querySelector(s).value = v; });
      if (guess) { const r = form.querySelector(`input[name="${DEVICE}"][value="${guess}"]`); if (r) r.checked = true; }
      done.hidden = true; form.hidden = false; wrap.querySelector('.contact-head').hidden = false;
      form.querySelector('#f-details').focus();
    });
  });

  // Year in footer
  document.querySelectorAll('[data-year]').forEach(el => { el.textContent = String(new Date().getFullYear()); });
})();
