(() => {
  const $ = id => document.getElementById(id);
  const STORE = {owners:'boxbook_owners_v1',session:'boxbook_session_v1'};
  let authMode = 'login';
  let authListenerStarted = false;

  function setMessage(message) {
    $('ownerAuthMessage').textContent = message || '';
  }
  function setAuthMode(mode) {
    authMode = mode;
    $('ownerAuthSubmit').textContent = mode === 'login' ? 'Login to Dashboard →' : 'Create Account →';
    $('ownerLoginTab').classList.toggle('active', mode === 'login');
    $('ownerSignupTab').classList.toggle('active', mode === 'signup');
    $('ownerLoginTab').toggleAttribute('aria-current', mode === 'login');
    $('ownerSignupTab').toggleAttribute('aria-current', mode === 'signup');
    setMessage(mode === 'signup' ? 'Create an account using your email and a password of at least 6 characters.' : '');
  }
  function saveOwnerSession(email) {
    const normalizedEmail = String(email || '').trim().toLowerCase();
    if (!normalizedEmail) return;
    localStorage.setItem(STORE.session, normalizedEmail);
    let owners = [];
    try { owners = JSON.parse(localStorage.getItem(STORE.owners) || '[]'); } catch {}
    if (!Array.isArray(owners)) owners = [];
    if (!owners.some(owner => String(owner.email || '').toLowerCase() === normalizedEmail)) {
      owners.push({email:normalizedEmail,subscription:false,plan:null});
      localStorage.setItem(STORE.owners, JSON.stringify(owners));
    }
    window.location.replace('owner-dashboard.html');
  }
  function connectAuthListener() {
    if (authListenerStarted || !window.firebaseAuthApi || !window.firebaseAuth) return;
    authListenerStarted = true;
    window.firebaseAuthApi.onAuthStateChanged(window.firebaseAuth, user => {
      if (user && user.email) saveOwnerSession(user.email);
    });
  }

  $('ownerLoginTab').addEventListener('click', () => setAuthMode('login'));
  $('ownerSignupTab').addEventListener('click', () => setAuthMode('signup'));
  $('ownerLoginForm').addEventListener('submit', async event => {
    event.preventDefault();
    const email = $('ownerEmail').value.trim().toLowerCase();
    const password = $('ownerPassword').value;
    const submit = $('ownerAuthSubmit');
    if (!window.firebaseAuthApi || !window.firebaseAuth) {
      setMessage('Login service is still loading. Please try again in a moment.');
      return;
    }
    submit.disabled = true;
    setMessage('');
    try {
      const result = authMode === 'signup'
        ? await window.firebaseAuthApi.createUserWithEmailAndPassword(window.firebaseAuth,email,password)
        : await window.firebaseAuthApi.signInWithEmailAndPassword(window.firebaseAuth,email,password);
      saveOwnerSession(result.user.email || email);
    } catch (error) {
      const messages = {
        'auth/email-already-in-use':'This email is already registered. Please log in.',
        'auth/invalid-email':'Please enter a valid email address.',
        'auth/invalid-credential':'Incorrect email or password.',
        'auth/weak-password':'Password must contain at least 6 characters.',
        'auth/network-request-failed':'Network error. Check your internet connection.',
        'auth/too-many-requests':'Too many attempts. Please try again later.'
      };
      setMessage(messages[error.code] || 'Authentication failed. Please try again.');
    } finally {
      submit.disabled = false;
    }
  });
  window.addEventListener('firebase-ready', connectAuthListener);
  connectAuthListener();
})();