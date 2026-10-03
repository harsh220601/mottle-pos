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

  // Year in footer
  document.querySelectorAll('[data-year]').forEach(el => { el.textContent = String(new Date().getFullYear()); });
})();
