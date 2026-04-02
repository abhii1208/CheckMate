import { useState } from 'react';
import toast from 'react-hot-toast';

import api from '../api';

function ResetPassword({ initialEmail = '', onBackToLogin }) {
  const [form, setForm] = useState({
    email: initialEmail,
    otp: '',
    newPassword: '',
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const handleChange = (event) => {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setErrorMessage('');

    try {
      setIsSubmitting(true);
      const response = await api.post('/auth/reset-password', form);

      toast.success(response.data.message);
      setForm((current) => ({ ...current, otp: '', newPassword: '' }));
      onBackToLogin(form.email);
    } catch (error) {
      setErrorMessage(error.userMessage || 'Unable to reset password right now.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <form className="auth-form" onSubmit={handleSubmit}>
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
          <span>OTP</span>
          <input
            type="text"
            name="otp"
            value={form.otp}
            onChange={handleChange}
            placeholder="Enter 6-digit OTP"
            inputMode="numeric"
            maxLength={6}
            required
          />
        </label>

        <label className="auth-field">
          <span>New password</span>
          <input
            type="password"
            name="newPassword"
            value={form.newPassword}
            onChange={handleChange}
            placeholder="Minimum 8 characters"
            autoComplete="new-password"
            required
          />
        </label>

        {errorMessage ? <div className="warning-banner">{errorMessage}</div> : null}

        <button type="submit" className="primary-btn auth-submit-btn" disabled={isSubmitting}>
          {isSubmitting ? 'Resetting password...' : 'Reset Password'}
        </button>
      </form>

      <p className="auth-footer-note">
        Need a new OTP?{' '}
        <button type="button" className="auth-inline-link" onClick={onBackToLogin}>
          Start again
        </button>
      </p>
    </>
  );
}

export default ResetPassword;
