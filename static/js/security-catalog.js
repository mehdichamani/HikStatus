// Particle background
  const canvas = document.getElementById('particle-canvas');
  const ctx = canvas.getContext('2d');
  let particles = [];
  function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }
  resize();
  window.addEventListener('resize', resize);

  class Particle {
    constructor() {
      this.reset();
      this.y = Math.random() * canvas.height;
    }
    reset() {
      this.x = Math.random() * canvas.width;
      this.y = -10;
      this.vy = Math.random() * 0.4 + 0.1;
      this.size = Math.random() * 1.2 + 0.3;
      this.alpha = Math.random() * 0.5 + 0.1;
      this.char = Math.random() > 0.5 ? '0' : '1';
      this.color = Math.random() > 0.7 ? '251, 191, 36' : '0, 229, 255';
    }
    update() {
      this.y += this.vy;
      if (this.y > canvas.height + 10) this.reset();
    }
    draw() {
      ctx.fillStyle = `rgba(${this.color}, ${this.alpha})`;
      ctx.font = `${this.size * 10}px Share Tech Mono`;
      ctx.fillText(this.char, this.x, this.y);
    }
  }
  for (let i = 0; i < 60; i++) particles.push(new Particle());

  function animate() {
    ctx.fillStyle = 'rgba(6, 9, 18, 0.08)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    particles.forEach(p => { p.update(); p.draw(); });
    requestAnimationFrame(animate);
  }
  animate();

  // Scroll progress
  window.addEventListener('scroll', () => {
    const sp = (window.scrollY / (document.body.scrollHeight - window.innerHeight)) * 100;
    document.getElementById('scroll-progress').style.width = sp + '%';
  });

  // Reveal on scroll
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) entry.target.classList.add('visible');
    });
  }, { threshold: 0.1 });
  document.querySelectorAll('.reveal').forEach(el => observer.observe(el));

  // Persian number converter
  function toPersian(n) {
    return n.toString().replace(/\d/g, d => '۰۱۲۳۴۵۶۷۸۹'[d]);
  }

  // Counter animation
  function animateCounter(el, target, duration = 2200) {
    const startTime = performance.now();
    function update(now) {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = Math.floor(target * eased);
      el.textContent = toPersian(current.toLocaleString('en-US'));
      if (progress < 1) requestAnimationFrame(update);
    }
    requestAnimationFrame(update);
  }
  const counterObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const target = parseInt(entry.target.dataset.counter);
        animateCounter(entry.target, target);
        counterObserver.unobserve(entry.target);
      }
    });
  }, { threshold: 0.5 });
  document.querySelectorAll('[data-counter]').forEach(el => counterObserver.observe(el));

  // PBKDF2 live counter
  let pbkdf2Count = 50000;
  const pbkdf2El = document.getElementById('pbkdf2-counter');
  let pbkdf2Started = false;
  pbkdf2El.textContent = toPersian(pbkdf2Count.toLocaleString('en-US'));
  function updatePbkdf2() {
    pbkdf2Count = Math.min(pbkdf2Count + 137, 100000);
    pbkdf2El.textContent = toPersian(pbkdf2Count.toLocaleString('en-US'));
    if (pbkdf2Count < 100000) requestAnimationFrame(updatePbkdf2);
  }
  const pbkdf2Observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting && !pbkdf2Started) {
        pbkdf2Started = true;
        updatePbkdf2();
      }
    });
  }, { threshold: 0.3 });
  pbkdf2Observer.observe(pbkdf2El);

  // Smooth scroll for nav links
  document.querySelectorAll('a[href^="#"]').forEach(link => {
    link.addEventListener('click', (e) => {
      const target = document.querySelector(link.getAttribute('href'));
      if (target) {
        e.preventDefault();
        target.scrollIntoView({ behavior: 'smooth' });
      }
    });
  });
