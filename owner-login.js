(() => {
  const $ = id => document.getElementById(id);
  const STORE = {owners:'boxbook_owners_v1',session:'boxbook_session_v1'};
  let authMode = 'login';
  let authListenerStarted = false;
  let signupInProgress = false;

  function setMessage(message) {
    $('ownerAuthMessage').textContent = message || '';
  }
  function setAuthMode(mode) {
    authMode = mode;
    const signup = mode === 'signup';
    $('ownerAuthSubmit').textContent = signup ? 'Create Account →' : 'Login to Dashboard →';
    $('ownerLoginTab').classList.toggle('active', !signup);
    $('ownerSignupTab').classList.toggle('active', signup);
    $('ownerLoginTab').toggleAttribute('aria-current', !signup);
    $('ownerSignupTab').toggleAttribute('aria-current', signup);
    $('ownerSignupFields').hidden = !signup;
    $('ownerConfirmField').hidden = !signup;
    $('ownerFullName').required = signup;
    $('ownerMobile').required = signup;
    $('ownerConfirmPassword').required = signup;
    $('ownerPassword').autocomplete = signup ? 'new-password' : 'current-password';
    $('ownerPassword').placeholder = signup ? 'Create a password (minimum 6 characters)' : 'Enter your password';
    setMessage(signup ? 'Enter your name, 10-digit mobile number and account details.' : '');
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
      if (user && user.email && !signupInProgress) saveOwnerSession(user.email);
    });
  }

  $('ownerLoginTab').addEventListener('click', () => setAuthMode('login'));
  $('ownerSignupTab').addEventListener('click', () => setAuthMode('signup'));
  $('ownerMobile').addEventListener('input', event => {
    event.target.value = event.target.value.replace(/\\D/g, '').slice(0, 10);
  });

  $('ownerLoginForm').addEventListener('submit', async event => {
    event.preventDefault();
    const email = $('ownerEmail').value.trim().toLowerCase();
    const password = $('ownerPassword').value;
    const submit = $('ownerAuthSubmit');
    const fullName = $('ownerFullName').value.trim();
    const mobile = $('ownerMobile').value.trim();
    const confirmPassword = $('ownerConfirmPassword').value;

    if (authMode === 'signup') {
      if (!fullName) return setMessage('Please enter your full name.');
      if (!/^[0-9]{10}$/.test(mobile)) return setMessage('Please enter a valid 10-digit mobile number.');
      if (password.length < 6) return setMessage('Password must contain at least 6 characters.');
      if (password !== confirmPassword) return setMessage('Password and Confirm Password do not match.');
    }

    if (!window.firebaseAuthApi || !window.firebaseAuth) {
      setMessage('Login service is still loading. Please try again in a moment.');
      return;
    }
    submit.disabled = true;
    setMessage(authMode === 'signup' ? 'Creating your account...' : 'Signing in...');
    try {
      if (authMode === 'signup') {
        signupInProgress = true;
        const result = await window.firebaseAuthApi.createUserWithEmailAndPassword(window.firebaseAuth,email,password);
        await window.firebaseAuthApi.saveOwnerProfile(window.firebaseDB, result.user.uid, {
          fullName,
          mobile,
          email: result.user.email || email
        });
        saveOwnerSession(result.user.email || email);
      } else {
        const result = await window.firebaseAuthApi.signInWithEmailAndPassword(window.firebaseAuth,email,password);
        saveOwnerSession(result.user.email || email);
      }
    } catch (error) {
      signupInProgress = false;
      const messages = {
        'auth/email-already-in-use':'This email is already registered. Please log in.',
        'auth/invalid-email':'Please enter a valid email address.',
        'auth/invalid-credential':'Incorrect email or password.',
        'auth/weak-password':'Password must contain at least 6 characters.',
        'auth/network-request-failed':'Network error. Check your internet connection.',
        'auth/too-many-requests':'Too many attempts. Please try again later.'
      };
      setMessage(messages[error.code] || (authMode === 'signup' ? 'Account could not be completed. Please try again.' : 'Authentication failed. Please try again.'));
    } finally {
      submit.disabled = false;
    }
  });
  window.addEventListener('firebase-ready', connectAuthListener);
  connectAuthListener();
})();