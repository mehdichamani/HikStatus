// تنظیم تم اولیه قبل از رندر کامل صفحه برای جلوگیری از چشک زدن سفید
(() => {
    const storedTheme = localStorage.getItem('hikstatus-theme') || 'system';
    if (storedTheme === 'light') {
        document.documentElement.setAttribute('data-theme', 'light');
        document.querySelector('meta[name="theme-color"]').setAttribute('content', '#f8fafc');
    } else if (storedTheme === 'system') {
        if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) {
            document.documentElement.setAttribute('data-theme', 'light');
            document.querySelector('meta[name="theme-color"]').setAttribute('content', '#f8fafc');
        } else {
            document.documentElement.removeAttribute('data-theme');
            document.querySelector('meta[name="theme-color"]').setAttribute('content', '#0a0a0f');
        }
    } else {
        document.documentElement.removeAttribute('data-theme');
        document.querySelector('meta[name="theme-color"]').setAttribute('content', '#0a0a0f');
    }
})();
