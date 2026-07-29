// Scroll Reveal Animation
        const reveals = document.querySelectorAll('.reveal');

        const revealOnScroll = () => {
            const windowHeight = window.innerHeight;
            const elementVisible = 100;

            reveals.forEach((reveal) => {
                const elementTop = reveal.getBoundingClientRect().top;
                if (elementTop < windowHeight - elementVisible) {
                    reveal.classList.add('active');
                }
            });
        };

        window.addEventListener('scroll', revealOnScroll);

        // Animated Counters
        const counters = document.querySelectorAll('[data-count]');
        let counterStarted = false;

        const startCounting = () => {
            const statsSection = document.getElementById('scale');
            const statsTop = statsSection.getBoundingClientRect().top;

            if (statsTop < window.innerHeight - 100 && !counterStarted) {
                counterStarted = true;
                counters.forEach(counter => {
                    const target = +counter.getAttribute('data-count');
                    let current = 0;
                    const increment = target / 60;

                    const updateCount = () => {
                        if (current < target) {
                            current += increment;
                            counter.innerText = Math.ceil(current).toLocaleString('fa-IR');
                            setTimeout(updateCount, 20);
                        } else {
                            counter.innerText = target.toLocaleString('fa-IR');
                        }
                    };
                    updateCount();
                });
            }
        };

        window.addEventListener('scroll', startCounting);

        // Mobile Nav Toggle (Basic implementation for future enhancement)
        // Can add mobile menu functionality here if needed
