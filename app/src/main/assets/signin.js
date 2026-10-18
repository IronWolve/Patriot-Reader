(() => {
  // Runs only in the isolated, first-party sign-in WebView. Never reads a password.
  if (location.origin !== 'https://patriots.win' || window.top !== window) return null;
  const api_key = localStorage.getItem('api_key');
  const api_secret = localStorage.getItem('api_secret');
  const valid = value => typeof value === 'string' && value.trim() !== '' &&
    value !== 'null' && value !== 'undefined';
  return valid(api_key) && valid(api_secret) ? JSON.stringify({api_key, api_secret}) : null;
})()
