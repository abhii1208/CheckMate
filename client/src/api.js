import axios from 'axios';

const fallbackBaseUrl = import.meta.env.DEV ? 'http://localhost:5002/api' : '/api';


const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || fallbackBaseUrl,
  timeout: 10000,
});

// Attach JWT token if present
export function setAuthToken(token) {
  if (token) {
    api.defaults.headers.common['Authorization'] = `Bearer ${token}`;
  } else {
    delete api.defaults.headers.common['Authorization'];
  }
}

// On load, set token from localStorage if present
try {
  const stored = localStorage.getItem('checkmate_auth');
  if (stored) {
    const { token } = JSON.parse(stored);
    if (token) setAuthToken(token);
  }
} catch {}

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (!error.response) {
      error.userMessage = 'Cannot reach the CheckMate API. Start the backend server to sync data.';
    } else {
      error.userMessage = error.response.data?.message || 'Something went wrong while processing your request.';
    }

    return Promise.reject(error);
  }
);

export default api;
