import { useState } from 'react';
import toast from 'react-hot-toast';

import api from '../api';

function ForgotPassword({ initialEmail = '', onBack, onOtpSent }) {
  const [email, setEmail] = useState(initialEmail);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const handleSubmit = async (event) => {
    event.preventDefault();
    setErrorMessage('');

    try {
      setIsSubmitting(true);
      const response = await api.post('/auth/forgot-password', { email });

      toast.success(response.data.message);
      onOtpSent(email.trim().toLowerCase());
    } catch (error) {
      setErrorMessage(error.userMessage || 'Unable to send OTP right now.');
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
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@example.com"
            autoComplete="email"
            required
          />
        </label>

        {errorMessage ? <div className="warning-banner">{errorMessage}</div> : null}

        <button type="submit" className="primary-btn auth-submit-btn" disabled={isSubmitting}>
          {isSubmitting ? 'Sending OTP...' : 'Send OTP'}
        </button>
      </form>

      <p className="auth-footer-note">
        Remembered your password?{' '}
        <button type="button" className="auth-inline-link" onClick={onBack}>
          Back to sign in
        </button>
      </p>
    </>
  );
}

export default ForgotPassword;
