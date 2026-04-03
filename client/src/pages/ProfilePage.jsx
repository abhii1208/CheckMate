import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';

import api, { setAuthToken } from '../api';
import { useAuth } from '../AuthContext';

function ProfilePage() {
  const { auth, updateAuthUser, logout } = useAuth();
  const [profileForm, setProfileForm] = useState({
    name: '',
    email: '',
    profileImageUrl: '',
    password: '',
  });
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: '',
    newPassword: '',
    otp: '',
  });
  const [deleteForm, setDeleteForm] = useState({
    password: '',
    otp: '',
  });
  const [isSendingOtp, setIsSendingOtp] = useState(false);
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);

  useEffect(() => {
    setProfileForm((current) => ({
      ...current,
      name: auth?.user?.name || '',
      email: auth?.user?.email || '',
      profileImageUrl: auth?.user?.profile_image_url || '',
    }));
  }, [auth]);

  const requestOtp = async (password) => {
    try {
      setIsSendingOtp(true);
      const response = await api.post('/auth/profile/request-otp', { password });
      toast.success(response.data.message);
      return true;
    } catch (error) {
      toast.error(error.userMessage || 'Could not send verification OTP.');
      return false;
    } finally {
      setIsSendingOtp(false);
    }
  };

  const handleProfileImageChange = (event) => {
    const selectedFile = event.target.files?.[0];

    if (!selectedFile) {
      return;
    }

    if (!selectedFile.type.startsWith('image/')) {
      toast.error('Please choose a valid image file.');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      setProfileForm((current) => ({
        ...current,
        profileImageUrl: String(reader.result || ''),
      }));
    };
    reader.readAsDataURL(selectedFile);
  };

  const handleSaveProfile = async (event) => {
    event.preventDefault();

    try {
      setIsSavingProfile(true);
      const normalizedEmail = profileForm.email.trim().toLowerCase();

      if (!/^\S+@\S+\.\S+$/.test(normalizedEmail)) {
        toast.error('Please enter a valid email address.');
        return;
      }

      const response = await api.put('/auth/profile', {
        name: profileForm.name.trim(),
        email: normalizedEmail,
        profileImageUrl: profileForm.profileImageUrl,
        password: profileForm.password,
      });

      localStorage.setItem('checkmate_auth', JSON.stringify({
        token: response.data.token,
        user: response.data.user,
      }));
      setAuthToken(response.data.token);
      updateAuthUser({ token: response.data.token, user: response.data.user });
      setProfileForm((current) => ({ ...current, password: '' }));
      toast.success(response.data.message);
    } catch (error) {
      toast.error(error.userMessage || 'Could not update your profile.');
    } finally {
      setIsSavingProfile(false);
    }
  };

  const handlePasswordChange = async (event) => {
    event.preventDefault();

    try {
      setIsChangingPassword(true);
      const response = await api.post('/auth/profile/change-password', passwordForm);
      setPasswordForm({ currentPassword: '', newPassword: '', otp: '' });
      toast.success(response.data.message);
    } catch (error) {
      toast.error(error.userMessage || 'Could not change the password.');
    } finally {
      setIsChangingPassword(false);
    }
  };

  const handleDeleteAccount = async (event) => {
    event.preventDefault();

    try {
      setIsDeletingAccount(true);
      const response = await api.post('/auth/profile/delete', deleteForm);
      toast.success(response.data.message);
      setAuthToken(null);
      logout();
    } catch (error) {
      toast.error(error.userMessage || 'Could not delete the account.');
    } finally {
      setIsDeletingAccount(false);
    }
  };

  return (
    <div className="page-stack">
      <section className="panel workflow-panel">
        <div className="section-header">
          <div>
            <span className="eyebrow">Account</span>
            <h2>Profile And Security</h2>
            <p>Update profile details, change your password, or delete the account with password confirmation and email OTP verification.</p>
          </div>
        </div>
      </section>

      <section className="profile-grid">
        <form className="panel profile-panel" onSubmit={handleSaveProfile}>
        <div className="section-header">
          <div>
            <h3>Profile details</h3>
            <p>Keep account information current and consumer-friendly. Only your current password is needed here.</p>
          </div>
            <div className="profile-avatar">
              {profileForm.profileImageUrl ? (
                <img src={profileForm.profileImageUrl} alt={profileForm.name || 'Profile'} />
              ) : (
                <span>{String(profileForm.name || 'C').trim().charAt(0).toUpperCase()}</span>
              )}
            </div>
          </div>

          <div className="editor-grid">
            <label className="editor-field">
              <span>Full name</span>
              <input
                type="text"
                value={profileForm.name}
                onChange={(event) => setProfileForm((current) => ({ ...current, name: event.target.value }))}
                required
              />
            </label>
            <label className="editor-field">
              <span>Email address</span>
              <input
                type="email"
                value={profileForm.email}
                onChange={(event) => setProfileForm((current) => ({ ...current, email: event.target.value }))}
                required
              />
            </label>
            <label className="editor-field">
              <span>Profile picture</span>
              <input type="file" accept="image/*" onChange={handleProfileImageChange} />
            </label>
            <label className="editor-field">
              <span>Current password</span>
              <input
                type="password"
                value={profileForm.password}
                onChange={(event) => setProfileForm((current) => ({ ...current, password: event.target.value }))}
                placeholder="Enter your login password"
                required
              />
            </label>
          </div>

          <div className="button-row">
            <button type="submit" className="primary-btn" disabled={isSavingProfile}>
              {isSavingProfile ? 'Saving profile...' : 'Save profile'}
            </button>
          </div>
        </form>

        <form className="panel profile-panel" onSubmit={handlePasswordChange}>
          <div className="section-header">
            <div>
              <h3>Change password</h3>
              <p>Re-enter the login password, request OTP, then set a new one.</p>
            </div>
          </div>

          <div className="editor-grid">
            <label className="editor-field">
              <span>Current password</span>
              <input
                type="password"
                value={passwordForm.currentPassword}
                onChange={(event) => setPasswordForm((current) => ({ ...current, currentPassword: event.target.value }))}
                required
              />
            </label>
            <label className="editor-field">
              <span>New password</span>
              <input
                type="password"
                value={passwordForm.newPassword}
                onChange={(event) => setPasswordForm((current) => ({ ...current, newPassword: event.target.value }))}
                required
              />
            </label>
            <label className="editor-field">
              <span>Email OTP</span>
              <input
                type="text"
                value={passwordForm.otp}
                onChange={(event) => setPasswordForm((current) => ({ ...current, otp: event.target.value }))}
                required
              />
            </label>
          </div>

          <div className="button-row">
            <button
              type="button"
              className="secondary-btn"
              onClick={() => requestOtp(passwordForm.currentPassword)}
              disabled={isSendingOtp || !passwordForm.currentPassword}
            >
              {isSendingOtp ? 'Sending OTP...' : 'Send verification OTP'}
            </button>
            <button type="submit" className="primary-btn" disabled={isChangingPassword}>
              {isChangingPassword ? 'Updating password...' : 'Change password'}
            </button>
          </div>
        </form>
      </section>

      <form className="panel profile-panel danger-panel" onSubmit={handleDeleteAccount}>
        <div className="section-header">
          <div>
            <h3>Delete account</h3>
            <p>This removes your account and related records. Confirm with password and email OTP.</p>
          </div>
        </div>
        <div className="editor-grid">
          <label className="editor-field">
            <span>Current password</span>
            <input
              type="password"
              value={deleteForm.password}
              onChange={(event) => setDeleteForm((current) => ({ ...current, password: event.target.value }))}
              required
            />
          </label>
          <label className="editor-field">
            <span>Email OTP</span>
            <input
              type="text"
              value={deleteForm.otp}
              onChange={(event) => setDeleteForm((current) => ({ ...current, otp: event.target.value }))}
              required
            />
          </label>
        </div>
        <div className="button-row">
          <button
            type="button"
            className="secondary-btn"
            onClick={() => requestOtp(deleteForm.password)}
            disabled={isSendingOtp || !deleteForm.password}
          >
            {isSendingOtp ? 'Sending OTP...' : 'Send verification OTP'}
          </button>
          <button type="submit" className="danger-btn" disabled={isDeletingAccount}>
            {isDeletingAccount ? 'Deleting account...' : 'Delete account'}
          </button>
        </div>
      </form>
    </div>
  );
}

export default ProfilePage;
