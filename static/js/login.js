let tempToken = '';

        async function handleLogin(e) {
            e.preventDefault();
            const btn = document.getElementById('login-btn');
            const errorMsg = document.getElementById('error-msg');
            const username = document.getElementById('username').value;
            const password = document.getElementById('password').value;

            errorMsg.classList.remove('show');
            btn.classList.add('loading');
            btn.disabled = true;
            let redirecting = false;

            try {
                const res = await fetch('/api/v1/auth/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username, password })
                });

                if (res.ok) {
                    const data = await res.json();

                    if (data.status === "2fa_required") {
                        tempToken = data.temp_token;
                        document.getElementById('login-form').style.display = 'none';
                        document.getElementById('login-2fa-form').style.display = 'block';
                        const codeField = document.getElementById('2fa-code');
                        codeField.value = '';
                        codeField.focus();
                        return;
                    }

                    localStorage.setItem('user_role', data.role);
                    if (data.group_id) {
                        localStorage.setItem('user_group_id', data.group_id);
                    } else {
                        localStorage.removeItem('user_group_id');
                    }
                    if (data.password_is_plain) {
                        localStorage.setItem('admin_plain_password', '1');
                    } else {
                        localStorage.removeItem('admin_plain_password');
                    }
                    redirecting = true;
                    window.location.href = '/';
                } else {
                    const data = await res.json();
                    errorMsg.textContent = data.detail || 'نام کاربری یا رمز عبور اشتباه است';
                    errorMsg.classList.add('show');
                }
            } catch (err) {
                errorMsg.textContent = 'خطا در اتصال به سرور';
                errorMsg.classList.add('show');
            } finally {
                if (!redirecting) {
                    btn.classList.remove('loading');
                    btn.disabled = false;
                }
            }
        }

        async function handle2FALogin(e) {
            e.preventDefault();
            const btn = document.getElementById('login-2fa-btn');
            const errorMsg = document.getElementById('error-msg');
            const code = document.getElementById('2fa-code').value.trim();

            if (code.length !== 6 || isNaN(code)) {
                errorMsg.textContent = 'لطفاً کد ۶ رقمی را به‌طور صحیح وارد کنید';
                errorMsg.classList.add('show');
                return;
            }

            errorMsg.classList.remove('show');
            btn.classList.add('loading');
            btn.disabled = true;
            let redirecting = false;

            try {
                const res = await fetch('/api/v1/auth/login/2fa', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ temp_token: tempToken, code })
                });

                if (res.ok) {
                    const data = await res.json();
                    localStorage.setItem('user_role', data.role);
                    if (data.group_id) {
                        localStorage.setItem('user_group_id', data.group_id);
                    } else {
                        localStorage.removeItem('user_group_id');
                    }
                    if (data.password_is_plain) {
                        localStorage.setItem('admin_plain_password', '1');
                    } else {
                        localStorage.removeItem('admin_plain_password');
                    }
                    redirecting = true;
                    window.location.href = '/';
                } else {
                    const data = await res.json();
                    errorMsg.textContent = data.detail || 'کد وارد شده صحیح نیست یا منقضی شده است';
                    errorMsg.classList.add('show');
                }
            } catch (err) {
                errorMsg.textContent = 'خطا در اتصال به سرور';
                errorMsg.classList.add('show');
            } finally {
                if (!redirecting) {
                    btn.classList.remove('loading');
                    btn.disabled = false;
                }
            }
        }

        function cancel2FALogin() {
            tempToken = '';
            document.getElementById('login-form').style.display = 'block';
            document.getElementById('login-2fa-form').style.display = 'none';
            document.getElementById('error-msg').classList.remove('show');
        }

        // Bind DOM event listeners to keep HTML free of inline JS
        document.addEventListener('DOMContentLoaded', () => {
            const loginForm = document.getElementById('login-form');
            if (loginForm) {
                loginForm.addEventListener('submit', handleLogin);
            }
            const login2faForm = document.getElementById('login-2fa-form');
            if (login2faForm) {
                login2faForm.addEventListener('submit', handle2FALogin);
            }
            const cancel2faBtn = document.getElementById('btn-cancel-2fa');
            if (cancel2faBtn) {
                cancel2faBtn.addEventListener('click', cancel2FALogin);
            }
        });

        if ('serviceWorker' in navigator) {
            window.addEventListener('load', () => {
                navigator.serviceWorker.register('/service-worker.js')
                    .then(reg => console.log('Service Worker registered', reg))
                    .catch(err => console.error('Service Worker registration failed', err));
            });
        }
