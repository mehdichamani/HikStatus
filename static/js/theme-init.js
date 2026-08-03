// تنظیم تم اولیه قبل از رندر کامل صفحه برای جلوگیری از چشمک زدن
(() => {
    let storedTheme = localStorage.getItem('hikstatus-theme') || 'classic-dark';
    if (storedTheme === 'light') storedTheme = 'classic-light';
    else if (storedTheme === 'dark' || storedTheme === 'system') storedTheme = 'classic-dark';

    const validThemes = [
        'classic-dark', 'classic-light',
        'navy-dark', 'navy-light',
        'emerald-dark', 'emerald-light',
        'violet-dark', 'violet-light'
    ];
    if (!validThemes.includes(storedTheme)) {
        storedTheme = 'classic-dark';
    }

    document.documentElement.setAttribute('data-theme', storedTheme);

    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
        const themeColors = {
            'classic-dark': '#0a0a0f',
            'classic-light': '#f8fafc',
            'navy-dark': '#0f172a',
            'navy-light': '#f4f6f9',
            'emerald-dark': '#022c22',
            'emerald-light': '#f0fdf4',
            'violet-dark': '#0b0716',
            'violet-light': '#faf5ff'
        };
        meta.setAttribute('content', themeColors[storedTheme] || '#0a0a0f');
    }
})();


