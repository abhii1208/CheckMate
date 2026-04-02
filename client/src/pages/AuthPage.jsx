import { useMemo, useState } from 'react';
import toast from 'react-hot-toast';

import api, { setAuthToken } from '../api';
import ForgotPassword from '../components/ForgotPassword';
import ResetPassword from '../components/ResetPassword';

const initialForm = {
  name: '',
  email: '',
  password: '',
  confirmPassword: '',
};

function AuthPage({ onAuthenticated }) {
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState(initialForm);
  const [resetEmail, setResetEmail] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const isLogin = mode === 'login';
  const isRegister = mode === 'register';
  const title = useMemo(() => (
    mode === 'login'
      ? 'Welcome back to faster inventory control'
      : mode === 'register'
        ? 'Create your CheckMate workspace'
        : mode === 'forgot'
          ? 'Request a password reset OTP'
          : 'Enter OTP and create a new password'
  ), [mode]);
  const subtitle = useMemo(() => (
    isLogin
      ? 'Sign in to continue scanning, adjusting stock, and exporting clean audit-ready inventory data.'
      : isRegister
        ? 'Register a secure account to manage stock changes, scan products, and keep each audit trail separate.'
        : mode === 'forgot'
          ? 'We will send a 6-digit OTP to the email address linked to your account.'
          : 'Use the OTP from your email and choose a new password to restore access.'
  ), [isLogin, isRegister, mode]);
  const passwordChecks = useMemo(() => ({
    minLength: form.password.length >= 8,
    hasLetter: /[A-Za-z]/.test(form.password),
    hasNumber: /\d/.test(form.password),
  }), [form.password]);
  const isRegisterValid = passwordChecks.minLength
    && passwordChecks.hasLetter
    && passwordChecks.hasNumber
    && form.password === form.confirmPassword;

  const handleChange = (event) => {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
  };

  const switchMode = (nextMode) => {
    setMode(nextMode);
    setErrorMessage('');
    setShowPassword(false);
    setShowConfirmPassword(false);

    if (nextMode === 'login' || nextMode === 'register') {
      setForm(initialForm);
    }
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setErrorMessage('');

    if (!isLogin) {
      if (!isRegisterValid) {
        setErrorMessage('Use at least 8 characters with letters and numbers, then confirm the password.');
        return;
      }
    }

    try {
      setIsSubmitting(true);
      const endpoint = isLogin ? '/auth/login' : '/auth/register';
      const payload = isLogin
        ? { email: form.email, password: form.password }
        : { name: form.name, email: form.email, password: form.password };

      const response = await api.post(endpoint, payload);
      const { token, user } = response.data;

      localStorage.setItem('checkmate_auth', JSON.stringify({ token, user }));
      setAuthToken(token);
      onAuthenticated({ token, user });
      toast.success(isLogin ? 'Welcome back.' : 'Account created successfully.');
    } catch (error) {
      setErrorMessage(error.userMessage || 'Authentication failed.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="auth-shell">
      <section className="auth-showcase">
        <div className="auth-brand">
          <img src="/checkmate-logo.svg" alt="CheckMate logo" className="auth-brand-logo" />
          <div>
            <span className="eyebrow">Inventory control platform</span>
            <h1>CheckMate</h1>
          </div>
        </div>

        <div className="auth-copy">
          <h2>Audit-ready stock workflows for real operations teams.</h2>
          <p>
            Move from spreadsheet imports to barcode verification and exportable stock updates in one clean flow.
          </p>
        </div>

        <div className="auth-metric-grid">
          <div className="auth-metric-card">
            <strong>4-step flow</strong>
            <span>Import, scan, adjust, download without switching tools.</span>
          </div>
          <div className="auth-metric-card">
            <strong>Secure access</strong>
            <span>Each account keeps its own inventory activity and audit history.</span>
          </div>
          <div className="auth-metric-card">
            <strong>Fast scanning</strong>
            <span>Use camera, image uploads, manual entry, or external barcode scanners.</span>
          </div>
        </div>

        <div className="auth-trust-list">
          <div className="auth-trust-item">Role-based login experience with separate registration</div>
          <div className="auth-trust-item">Password validation before account creation</div>
          <div className="auth-trust-item">Built for warehouse audits, retail checks, and stock reviews</div>
        </div>
      </section>

      <section className="auth-card">
        <div className="auth-card-header">
          <div>
            <span className="eyebrow">{isLogin ? 'Sign in' : 'Register'}</span>
            <h2>{title}</h2>
            <p>{subtitle}</p>
          </div>

          <div className="auth-mode-switch" role="tablist" aria-label="Authentication mode">
            <button
              type="button"
              className={`auth-mode-btn ${isLogin ? 'active' : ''}`}
              onClick={() => switchMode('login')}
            >
              Sign in
            </button>
            <button
              type="button"
              className={`auth-mode-btn ${!isLogin ? 'active' : ''}`}
              onClick={() => switchMode('register')}
            >
              Register
            </button>
          </div>
        </div>

        {mode === 'forgot' ? (
          <ForgotPassword
            initialEmail={resetEmail || form.email}
            onBack={() => switchMode('login')}
            onOtpSent={(email) => {
              setResetEmail(email);
              setForm((current) => ({ ...current, email }));
              setMode('reset');
            }}
          />
        ) : mode === 'reset' ? (
          <ResetPassword
            initialEmail={resetEmail || form.email}
            onBackToLogin={(email) => {
              if (email) {
                setResetEmail(email);
                setForm((current) => ({ ...current, email }));
              }

              setMode('login');
            }}
          />
        ) : (
          <>
            <form className="auth-form" onSubmit={handleSubmit}>
              {!isLogin ? (
                <label className="auth-field">
                  <span>Full name</span>
                  <input
                    type="text"
                    name="name"
                    value={form.name}
                    onChange={handleChange}
                    placeholder="Enter your full name"
                    autoComplete="name"
                    required
                  />
                </label>
              ) : null}

              <label className="auth-field">
                <span>Email address</span>
                <input
                  type="email"
                  name="email"
                  value={form.email}
                  onChange={handleChange}
                  placeholder="you@example.com"
                  autoComplete="email"
                  required
                />
              </label>

              <label className="auth-field">
                <span>Password</span>
                <div className="auth-password-wrap">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    name="password"
                    value={form.password}
                    onChange={handleChange}
                    placeholder="Minimum 8 characters"
                    autoComplete={isLogin ? 'current-password' : 'new-password'}
                    required
                  />
                  <button
                    type="button"
                    className="auth-toggle-btn"
                    onClick={() => setShowPassword((current) => !current)}
                  >
                    {showPassword ? 'Hide' : 'Show'}
                  </button>
                </div>
              </label>

              {!isLogin ? (
                <>
                  <label className="auth-field">
                    <span>Confirm password</span>
                    <div className="auth-password-wrap">
                      <input
                        type={showConfirmPassword ? 'text' : 'password'}
                        name="confirmPassword"
                        value={form.confirmPassword}
                        onChange={handleChange}
                        placeholder="Repeat your password"
                        autoComplete="new-password"
                        required
                      />
                      <button
                        type="button"
                        className="auth-toggle-btn"
                        onClick={() => setShowConfirmPassword((current) => !current)}
                      >
                        {showConfirmPassword ? 'Hide' : 'Show'}
                      </button>
                    </div>
                  </label>

                  <div className="auth-password-checks">
                    <div className={passwordChecks.minLength ? 'pass' : ''}>At least 8 characters</div>
                    <div className={passwordChecks.hasLetter ? 'pass' : ''}>Contains a letter</div>
                    <div className={passwordChecks.hasNumber ? 'pass' : ''}>Contains a number</div>
                    <div className={form.confirmPassword && form.password === form.confirmPassword ? 'pass' : ''}>
                      Passwords match
                    </div>
                  </div>
                </>
              ) : (
                <p className="auth-footer-note">
                  <button
                    type="button"
                    className="auth-inline-link"
                    onClick={() => {
                      setResetEmail(form.email.trim().toLowerCase());
                      setMode('forgot');
                    }}
                  >
                    Forgot Password?
                  </button>
                </p>
              )}

              {errorMessage ? <div className="warning-banner">{errorMessage}</div> : null}

              <button
                type="submit"
                className="primary-btn auth-submit-btn"
                disabled={isSubmitting || (!isLogin && !isRegisterValid)}
              >
                {isSubmitting ? 'Please wait...' : isLogin ? 'Sign in to CheckMate' : 'Create secure account'}
              </button>
            </form>

            <p className="auth-footer-note">
              {isLogin ? 'Need an account?' : 'Already registered?'}{' '}
              <button
                type="button"
                className="auth-inline-link"
                onClick={() => switchMode(isLogin ? 'register' : 'login')}
              >
                {isLogin ? 'Create one now' : 'Sign in instead'}
              </button>
            </p>
          </>
        )}
      </section>
    </div>
  );
}

export default AuthPage;
