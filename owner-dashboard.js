(() => {
  const STORE = {grounds:'boxbook_grounds_v1', bookings:'boxbook_bookings_v1', plan:'boxbook_owner_plan_v1', planExpiry:'boxbook_owner_plan_expiry_v1'};
  const savedOwnerSession = (localStorage.getItem('boxbook_session_v1') || '').trim().toLowerCase();
  if (!savedOwnerSession) { window.location.replace('owner-login.html'); return; }
  const OWNER_EMAIL = savedOwnerSession;
  const $ = (id) => document.getElementById(id);
  const readList = (key) => { try { const data = JSON.parse(localStorage.getItem(key)); return Array.isArray(data) ? data : []; } catch { return []; } };
  const groundsForOwner = () => readList(STORE.grounds).filter(g => g.owner === OWNER_EMAIL).map(g => ({...g, sport:g.sportType || g.sport || 'Box Cricket', location:g.location || [g.area,g.city].filter(Boolean).join(', '), price:Number(g.price || 0)}));
  const bookingsForOwner = () => readList(STORE.bookings).filter(b => b.owner === OWNER_EMAIL).map(b => ({id:b.id, customer:b.customerName || 'Customer', email:b.phone || '', ground:b.groundName || 'Ground', date:b.date || '', time:b.slot || '', amount:Number(b.amount||0), paymentStatus:b.paymentStatus||'', status:((!b.status||b.status==='Pending')&&b.holdExpiresAt&&Number(b.holdExpiresAt)<=Date.now())?'Expired':(b.status || 'Pending')}));
  let selectedPlan = (() => { try { const plans = JSON.parse(localStorage.getItem(STORE.plan) || '{}'); return plans[OWNER_EMAIL] || ''; } catch { return ''; } })();
  let toastTimer;
  const NOTIFICATION_STORE = 'boxbook_admin_notifications_v1';
  const NOTIFICATION_READ_STORE = 'boxbook_owner_notifications_read_v1';
  function readAdminNotifications() {
    try {
      const items = JSON.parse(localStorage.getItem(NOTIFICATION_STORE) || '[]');
      return Array.isArray(items) ? items.filter(item => item && (!item.ownerEmail || String(item.ownerEmail).trim().toLowerCase() === OWNER_EMAIL || item.ownerEmail === '*')) : [];
    } catch { return []; }
  }
  function readNotificationIds() {
    try {
      const data = JSON.parse(localStorage.getItem(NOTIFICATION_READ_STORE) || '{}');
      return Array.isArray(data[OWNER_EMAIL]) ? data[OWNER_EMAIL] : [];
    } catch { return []; }
  }
  function renderNotifications() {
    const list = $('notificationList');
    if (!list) return;
    const items = readAdminNotifications().sort((a,b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
    const readIds = readNotificationIds();
    const unread = items.filter(item => !readIds.includes(String(item.id || item.createdAt || item.title || 'notification'))).length;
    $('notificationBadge').textContent = unread > 99 ? '99+' : String(unread);
    $('notificationBadge').classList.toggle('hidden', unread === 0);
    $('notificationSummary').textContent = unread ? unread + (unread === 1 ? ' unread update' : ' unread updates') : 'You are all caught up';
    list.innerHTML = items.length ? items.map(item => {
      const id = String(item.id || item.createdAt || item.title || 'notification');
      const isRead = readIds.includes(id);
      const date = item.createdAt ? new Date(Number(item.createdAt)).toLocaleString('en-IN', {day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}) : '';
      return '<article class="notification-item' + (isRead ? ' is-read' : ' is-unread') + '"><span class="notification-status-dot" aria-hidden="true"></span><div><strong>' + escapeHTML(item.title || 'BoxBook update') + '</strong><p>' + escapeHTML(item.message || '') + '</p>' + (date ? '<small>' + escapeHTML(date) + '</small>' : '') + '</div></article>';
    }).join('') : '<p class="notification-empty">No notifications yet. Super Admin updates will appear here.</p>';
  }
  let grounds = groundsForOwner();
  let sampleBookings = bookingsForOwner();
  const saveGrounds = () => { try { const all = readList(STORE.grounds).filter(g => g.owner !== OWNER_EMAIL); localStorage.setItem(STORE.grounds, JSON.stringify([...all, ...grounds.map(g => ({...g, sportType:g.sport, owner:OWNER_EMAIL}))])); } catch {} };
  const money = (n) => '₹' + Number(n || 0).toLocaleString('en-IN');
  const escapeHTML = (value='') => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function toast(message) {
    const el = $('toast'); el.textContent = message; el.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 2800);
  }
  function showView(name) {
    document.querySelectorAll('.view').forEach(view => view.classList.toggle('active', view.id === 'view-' + name));
    document.querySelectorAll('.nav-link').forEach(link => link.classList.toggle('active', link.dataset.view === name));
    const labels = {overview:'Overview',grounds:'My Grounds',bookings:'Booking Control Center',subscription:'Subscription'};
    $('breadcrumbTitle').textContent = labels[name] || 'Overview';
    $('sidebar').classList.remove('open');
    window.scrollTo({top:0,behavior:'smooth'});
  }
  function timeMinutes(value) { const m = /^(\d{2}):(\d{2})$/.exec(value || ''); return m ? Number(m[1]) * 60 + Number(m[2]) : null; }
  function rangeForBooking(b) {
    let start=b.startTime,end=b.endTime;
    if ((!start||!end)&&b.slot) {
      const m=/^(\d{1,2}):(\d{2})\s*(AM|PM)\s*-\s*(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(b.slot);
      if(m){let sh=Number(m[1])%12,eh=Number(m[4])%12;if(m[3].toUpperCase()==='PM')sh+=12;if(m[6].toUpperCase()==='PM')eh+=12;start=String(sh).padStart(2,'0')+':'+m[2];end=String(eh).padStart(2,'0')+':'+m[5];}
    }
    const sm=timeMinutes(start),em=timeMinutes(end);if(!b.date||sm===null||em===null||sm===em)return null;
    const a=new Date(b.date+'T00:00:00');a.setMinutes(sm);const z=new Date(b.date+'T00:00:00');z.setMinutes(em);if(em<=sm)z.setDate(z.getDate()+1);
    return {groundId:b.groundId,start:a.getTime(),end:z.getTime()};
  }
  function overlaps(a,b) { const x=rangeForBooking(a),y=rangeForBooking(b);return !!(x&&y&&x.groundId===y.groundId&&x.start<y.end&&x.end>y.start); }
  function bookingRow(b, full=false) {
    return '<tr><td><span class="booking-id">' + escapeHTML(b.id) + '</span></td>' +
      (full ? '<td><div class="customer-cell"><strong>' + escapeHTML(b.customer) + '</strong><small>' + escapeHTML(b.email) + '</small></div></td><td>' + escapeHTML(b.ground) + '</td>' : '<td><div class="customer-cell"><strong>' + escapeHTML(b.customer) + '</strong></div></td>') +
      '<td>' + escapeHTML(b.date) + '<br><small>' + escapeHTML(b.time) + '</small></td><td>' + money(b.amount) + '</td><td><span class="status ' + (b.status === 'Confirmed' ? 'confirmed' : (b.status === 'Rejected' || b.status === 'Expired') ? 'rejected' : 'pending') + '">' + escapeHTML(b.status) + '</span>' + (b.paymentStatus ? '<br><small>' + escapeHTML(b.paymentStatus) + '</small>' : '') + '</td>' + (full ? '<td>' + (b.status === 'Pending' ? '<button type="button" class="approve-btn" data-approve="' + escapeHTML(b.id) + '">Approve</button> <button type="button" class="reject-btn" data-reject="' + escapeHTML(b.id) + '">Reject</button>' : '—') + '</td>' : '') + '</tr>';
  }
  function renderBookings() {
    sampleBookings = bookingsForOwner();
    const filter = $('bookingFilter').value;
    const query = $('bookingSearch').value.trim().toLowerCase();
    const selectedDate = $('bookingDateFilter').value;
    const newestFirst = [...sampleBookings].sort((a,b) => String(b.date).localeCompare(String(a.date)) || String(b.id).localeCompare(String(a.id)));
    const list = newestFirst.filter(b =>
      (filter === 'all' || b.status === filter) &&
      (!selectedDate || b.date === selectedDate) &&
      (!query || [b.id,b.customer,b.email,b.ground].some(value => String(value || '').toLowerCase().includes(query)))
    );
    $('bookingRows').innerHTML = list.length ? list.map(b => bookingRow(b, true)).join('') : '<tr><td colspan="7">No bookings match these filters.</td></tr>';
    $('recentBookingRows').innerHTML = newestFirst.slice(0, 3).map(b => bookingRow(b, false)).join('') || '<tr><td colspan="5">No bookings yet. New requests will appear here.</td></tr>';
    $('statBookings').textContent = String(sampleBookings.length);
    const pendingCount = sampleBookings.filter(b => b.status === 'Pending').length;
    $('statPending').textContent = String(pendingCount);
    $('bookingCount').textContent = String(pendingCount);
    $('statRevenue').textContent = money(sampleBookings.filter(b => b.status === 'Confirmed').reduce((sum,b) => sum + b.amount, 0));
  }
  function renderGrounds() {
    $('statGrounds').textContent = String(grounds.length);
    $('groundsGrid').innerHTML = grounds.map(g => '<article class="ground-card"><div class="ground-art">⌂</div><div class="ground-card-body"><span class="sport-tag">' + escapeHTML(g.sport.toUpperCase()) + '</span><h3 style="margin-top:11px">' + escapeHTML(g.name) + '</h3><p>⌖ ' + escapeHTML(g.location) + '<br>' + escapeHTML(g.description || 'Sports ground available for booking.') + '</p><div class="ground-meta"><strong>' + money(g.price) + ' <small>/ hour</small></strong><span class="demo-pill">DEMO LISTING</span></div><div class="ground-actions"><small style="color:#9ca3af;font-size:10px">Shared browser demo</small><button class="delete-btn" data-delete="' + escapeHTML(g.id) + '">Remove</button></div></div></article>').join('');
    $('groundsEmpty').classList.toggle('hidden', grounds.length > 0);
    $('groundsGrid').classList.toggle('hidden', grounds.length === 0);
  }
  function groundLimit() { return selectedPlan.includes('2 Grounds') ? 2 : selectedPlan.includes('1 Ground') ? 1 : 0; }
  function saveSelectedPlan() {
    try {
      const plans = JSON.parse(localStorage.getItem(STORE.plan) || '{}');
      plans[OWNER_EMAIL] = selectedPlan;
      localStorage.setItem(STORE.plan, JSON.stringify(plans));
    } catch {}
  }
  function getPlanExpiry() {
    try { const dates = JSON.parse(localStorage.getItem(STORE.planExpiry) || '{}'); return dates[OWNER_EMAIL] || ''; } catch { return ''; }
  }
  function formatPlanDate(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('en-IN', {day:'2-digit',month:'short',year:'numeric'});
  }
  function daysUntilExpiry(value) {
    const expiry = new Date(value);
    if (Number.isNaN(expiry.getTime())) return null;
    return Math.max(0, Math.ceil((expiry.getTime() - Date.now()) / 86400000));
  }
  function renderPlanExpiryAlert() {
    const alert = $('planExpiryAlert');
    if (!alert) return;
    const expiryValue = getPlanExpiry();
    const expiryDate = new Date(expiryValue);
    const daysLeft = expiryValue ? daysUntilExpiry(expiryValue) : null;
    const dismissedKey = 'boxbook_plan_expiry_notice_dismissed_v1';
    let dismissed = {};
    try { dismissed = JSON.parse(localStorage.getItem(dismissedKey) || '{}') || {}; } catch {}
    const noticeKey = OWNER_EMAIL + ':' + expiryValue;
    const isExpired = expiryValue && !Number.isNaN(expiryDate.getTime()) && expiryDate.getTime() <= Date.now();
    const shouldShow = !!selectedPlan && !!expiryValue && (isExpired || (daysLeft !== null && daysLeft <= 10));
    if (!shouldShow || dismissed[OWNER_EMAIL] === noticeKey) {
      alert.classList.add('hidden');
      return;
    }
    $('planExpiryAlertTitle').textContent = isExpired ? 'Your subscription plan has expired' : 'Your subscription plan is expiring soon';
    $('planExpiryAlertText').textContent = isExpired
      ? 'Your ' + selectedPlan + ' plan expired on ' + formatPlanDate(expiryValue) + '. Renew your plan to continue.'
      : 'Your ' + selectedPlan + ' plan expires on ' + formatPlanDate(expiryValue) + ' — ' + daysLeft + (daysLeft === 1 ? ' day' : ' days') + ' left. Renew in time to avoid interruption.';
    alert.classList.remove('hidden');
  }
  function setPlanExpiry() {
    const expiry = new Date();
    if (selectedPlan.startsWith('Free Trial')) expiry.setDate(expiry.getDate() + 10);
    else if (selectedPlan.startsWith('Yearly')) expiry.setFullYear(expiry.getFullYear() + 1);
    else expiry.setMonth(expiry.getMonth() + 1);
    try {
      const dates = JSON.parse(localStorage.getItem(STORE.planExpiry) || '{}');
      dates[OWNER_EMAIL] = expiry.toISOString();
      localStorage.setItem(STORE.planExpiry, JSON.stringify(dates));
    } catch {}
  }
  function syncPlanPreview() {
    if (!selectedPlan) {
      $('dashboardPlanName').textContent = 'No plan selected';
      $('dashboardPlanExpiry').textContent = 'Choose a plan in Subscription to see its expiry date.';
      renderPlanExpiryAlert();
      return;
    }
    const expiryValue = getPlanExpiry();
    const expiryText = formatPlanDate(expiryValue);
    const daysLeft = expiryValue ? daysUntilExpiry(expiryValue) : null;
    const expiryDetails = expiryText ? 'Expiring after ' + expiryText + ' (' + daysLeft + (daysLeft === 1 ? ' day left).' : ' days left).') : '';
    $('planNoticeTitle').textContent = selectedPlan + ' plan selected for preview';
    $('planNoticeText').textContent = 'Demo mode: this plan allows up to ' + groundLimit() + (groundLimit() === 1 ? ' ground. ' : ' grounds. ') + (expiryDetails ? expiryDetails + ' ' : '') + 'No payment has been taken.';
    $('dashboardPlanName').textContent = selectedPlan;
    $('dashboardPlanExpiry').textContent = expiryDetails || 'Expiry date is not set yet.';
    document.querySelectorAll('.plan-select').forEach(b => { b.textContent = b.dataset.plan === selectedPlan ? 'Selected for preview' : 'Select Plan'; });
    renderPlanExpiryAlert();
  }
  function openGroundForm() {
    const limit = groundLimit();
    if (!limit) { showView('subscription'); toast('Please select a plan before adding a ground.'); return; }
    if (grounds.length >= limit) { showView('subscription'); toast('Your selected plan allows up to ' + limit + (limit === 1 ? ' ground. ' : ' grounds. ') + 'Choose a 2 Grounds plan to add another.'); return; }
    $('groundFormPanel').classList.remove('hidden');
    $('groundFormPanel').scrollIntoView({behavior:'smooth',block:'start'});
  }
  document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => showView(button.dataset.view)));
  $('renewPlanButton').addEventListener('click', () => showView('subscription'));
  $('closePlanExpiryAlert').addEventListener('click', () => {
    const expiryValue = getPlanExpiry();
    const dismissedKey = 'boxbook_plan_expiry_notice_dismissed_v1';
    let dismissed = {};
    try { dismissed = JSON.parse(localStorage.getItem(dismissedKey) || '{}') || {}; } catch {}
    dismissed[OWNER_EMAIL] = OWNER_EMAIL + ':' + expiryValue;
    try { localStorage.setItem(dismissedKey, JSON.stringify(dismissed)); } catch {}
    $('planExpiryAlert').classList.add('hidden');
  });
  document.querySelectorAll('[data-go]').forEach(button => button.addEventListener('click', () => { showView(button.dataset.go); if (button.dataset.go === 'grounds') openGroundForm(); }));
  $('menuToggle').addEventListener('click', () => $('sidebar').classList.toggle('open'));
  $('showGroundForm').addEventListener('click', openGroundForm);
  document.querySelectorAll('[data-open-form]').forEach(button => button.addEventListener('click', openGroundForm));
  ['cancelGroundForm','cancelGroundForm2'].forEach(id => $(id).addEventListener('click', () => $('groundFormPanel').classList.add('hidden')));
  $('groundForm').addEventListener('submit', event => {
    event.preventDefault();
    const name = $('groundName').value.trim(), location = $('groundLocation').value.trim(), price = Number($('groundPrice').value);
    if (!name || !location || !Number.isFinite(price) || price < 1) { toast('Please check the ground details.'); return; }
    const limit = groundLimit();
    if (!limit) { toast('Please select a plan before adding a ground.'); showView('subscription'); return; }
    if (grounds.length >= limit) { toast('Your selected plan allows up to ' + limit + (limit === 1 ? ' ground.' : ' grounds.') + ' Choose a 2 Grounds plan to add another.'); showView('subscription'); return; }
    grounds.push({id:'ground-' + Date.now(),name,sport:$('groundSport').value,sportType:$('groundSport').value,location,price,upiId:$('groundUpiId').value.trim(),qrImageUrl:$('groundQrImageUrl').value.trim(),description:$('groundDescription').value.trim(),owner:OWNER_EMAIL,slots:[]});
    saveGrounds(); renderGrounds(); $('groundForm').reset(); $('groundFormPanel').classList.add('hidden'); toast('Ground added to this browser demo.');
  });
  $('groundsGrid').addEventListener('click', event => {
    const button = event.target.closest('[data-delete]'); if (!button) return;
    grounds = grounds.filter(g => g.id !== button.dataset.delete); saveGrounds(); renderGrounds(); toast('Demo ground removed from the shared listing.');
  });
  $('bookingFilter').addEventListener('change', renderBookings);
  $('bookingSearch').addEventListener('input', renderBookings);
  $('bookingDateFilter').addEventListener('change', renderBookings);
  $('bookingRows').addEventListener('click', event => {
    const approveButton = event.target.closest('[data-approve]');
    const rejectButton = event.target.closest('[data-reject]');
    if (!approveButton && !rejectButton) return;
    const bookingId = approveButton ? approveButton.dataset.approve : rejectButton.dataset.reject;
    const allBookings = readList(STORE.bookings);
    const booking = allBookings.find(b => b.id === bookingId && b.owner === OWNER_EMAIL);
    if (!booking || (booking.status && booking.status !== 'Pending')) return;
    if (booking.holdExpiresAt && Number(booking.holdExpiresAt) <= Date.now()) { booking.status = 'Expired'; try { localStorage.setItem(STORE.bookings, JSON.stringify(allBookings)); } catch {} renderBookings(); toast('Pending hold expired. Slot is available again.'); return; }
    if (rejectButton) { booking.status = 'Rejected'; try { localStorage.setItem(STORE.bookings, JSON.stringify(allBookings)); } catch { toast('Could not save the rejection in this browser.'); return; } renderBookings(); toast('Booking request rejected. Slot released.'); return; }
    const confirmedConflict = allBookings.some(other => other.id !== booking.id && other.groundId === booking.groundId && other.status === 'Confirmed' && overlaps(booking, other));
    if (confirmedConflict) { toast('This time overlaps an already confirmed booking.'); return; }
    booking.status = 'Confirmed'; booking.confirmedAt = Date.now();
    allBookings.forEach(other => { if (other.id !== booking.id && other.owner === OWNER_EMAIL && (!other.status || other.status === 'Pending') && (!other.holdExpiresAt || Number(other.holdExpiresAt) > Date.now()) && overlaps(booking, other)) other.status = 'Rejected'; });
    try { localStorage.setItem(STORE.bookings, JSON.stringify(allBookings)); } catch { toast('Could not save approval in this browser.'); return; }
    renderBookings(); toast('Booking approved. Overlapping pending requests were rejected so the slot cannot be confirmed twice.');
  });
  document.querySelectorAll('.plan-select').forEach(button => button.addEventListener('click', () => {
    selectedPlan = button.dataset.plan;
    setPlanExpiry();
    saveSelectedPlan();
    syncPlanPreview();
    toast(selectedPlan + ' plan selected for this browser demo.');
  }));
  syncPlanPreview();
  const notificationTrigger = $('notificationTrigger');
  const notificationPanel = $('notificationPanel');
  if (notificationTrigger && notificationPanel) {
    notificationTrigger.addEventListener('click', () => {
      const opening = notificationPanel.classList.contains('hidden');
      notificationPanel.classList.toggle('hidden', !opening);
      notificationTrigger.setAttribute('aria-expanded', String(opening));
      closeProfileMenuIfAvailable();
    });
    $('markNotificationsRead').addEventListener('click', () => {
      const ids = readAdminNotifications().map(item => String(item.id || item.createdAt || item.title || 'notification'));
      try {
        const all = JSON.parse(localStorage.getItem(NOTIFICATION_READ_STORE) || '{}');
        all[OWNER_EMAIL] = Array.from(new Set([...(Array.isArray(all[OWNER_EMAIL]) ? all[OWNER_EMAIL] : []), ...ids]));
        localStorage.setItem(NOTIFICATION_READ_STORE, JSON.stringify(all));
      } catch {}
      renderNotifications();
    });
    document.addEventListener('click', event => {
      if (!event.target.closest('.notification-wrap')) {
        notificationPanel.classList.add('hidden');
        notificationTrigger.setAttribute('aria-expanded', 'false');
      }
    });
  }
  function closeProfileMenuIfAvailable() {
    const dropdown = $('profileDropdown');
    const trigger = $('profileMenuTrigger');
    if (dropdown && trigger) {
      dropdown.classList.add('hidden');
      trigger.setAttribute('aria-expanded', 'false');
    }
  }
  renderNotifications();

  // Owner account dropdown
  const profileMenuTrigger = $('profileMenuTrigger');
  const profileDropdown = $('profileDropdown');
  const accountModal = $('accountModal');
  const accountModalTitle = $('accountModalTitle');
  const accountModalEyebrow = $('accountModalEyebrow');
  const accountModalBody = $('accountModalBody');
  function closeProfileMenu() {
    if (!profileDropdown || !profileMenuTrigger) return;
    profileDropdown.classList.add('hidden');
    profileMenuTrigger.setAttribute('aria-expanded', 'false');
  }
  function openAccountModal(title, eyebrow, body) {
    accountModalTitle.textContent = title;
    accountModalEyebrow.textContent = eyebrow;
    accountModalBody.innerHTML = body;
    accountModal.classList.remove('hidden');
    closeProfileMenu();
  }
  if (profileMenuTrigger && profileDropdown) {
    profileMenuTrigger.addEventListener('click', () => {
      const isOpen = !profileDropdown.classList.contains('hidden');
      profileDropdown.classList.toggle('hidden', isOpen);
      profileMenuTrigger.setAttribute('aria-expanded', String(!isOpen));
    });
    document.addEventListener('click', event => {
      if (!event.target.closest('.profile-menu-wrap')) closeProfileMenu();
    });
    profileDropdown.addEventListener('click', event => {
      const button = event.target.closest('[data-profile-action]');
      if (!button) return;
      const action = button.dataset.profileAction;
      if (action === 'profile') {
        const savedProfile = (() => { try { return JSON.parse(localStorage.getItem('boxbook_owner_profile_v1') || '{}') || {}; } catch { return {}; } })();
        openAccountModal('Profile', 'OWNER ACCOUNT',
          '<form id="ownerProfileForm" class="owner-profile-form">' +
          '<label>Your name<input name="yourName" type="text" maxlength="80" autocomplete="name" value="' + escapeHTML(savedProfile.yourName || '') + '" placeholder="Enter your name"></label>' +
          '<label>Account name<input name="accountName" type="text" maxlength="80" value="' + escapeHTML(savedProfile.accountName || 'Owner Account') + '" placeholder="Account name"></label>' +
          '<label>Email address<input name="email" type="email" value="' + escapeHTML(OWNER_EMAIL) + '" readonly></label>' +
          '<label>Mobile number<input name="mobile" type="tel" inputmode="numeric" maxlength="10" pattern="[0-9]{10}" value="' + escapeHTML(savedProfile.mobile || '') + '" placeholder="10-digit mobile number"></label>' +
          '<p class="account-modal-note">Your name and mobile number are saved in this browser. Email is read-only because it comes from the current login.</p>' +
          '<div class="account-modal-actions"><button type="submit">Save Profile</button></div></form>');
        const profileForm = $('ownerProfileForm');
        profileForm.addEventListener('submit', event => {
          event.preventDefault();
          const formData = new FormData(profileForm);
          const mobile = String(formData.get('mobile') || '').trim();
          if (mobile && !/^[0-9]{10}$/.test(mobile)) { toast('Enter a valid 10-digit mobile number.'); return; }
          const profile = {
            yourName: String(formData.get('yourName') || '').trim(),
            accountName: String(formData.get('accountName') || '').trim() || 'Owner Account',
            mobile
          };
          try {
            localStorage.setItem('boxbook_owner_profile_v1', JSON.stringify(profile));
            const nameLabel = document.querySelector('.profile-copy strong');
            if (nameLabel) nameLabel.textContent = profile.accountName;
            toast('Profile saved in this browser.');
            accountModal.classList.add('hidden');
          } catch { toast('Could not save profile in this browser.'); }
        });
      } else if (action === 'plan') {
        closeProfileMenu();
        showView('subscription');
      } else if (action === 'password') {
        openAccountModal('Password Change', 'ACCOUNT SECURITY',
          '<p class="account-modal-note">Password changes need a secure login system. This dashboard is not connected to a secure password service yet, so your password cannot be changed here safely.</p><div class="account-modal-actions"><button type="button" id="passwordModalOk">Got it</button></div>');
        const ok = $('passwordModalOk');
        if (ok) ok.addEventListener('click', () => accountModal.classList.add('hidden'));
      } else if (action === 'logout') {
        closeProfileMenu();
        try { localStorage.removeItem('boxbook_session_v1'); } catch {}
        window.location.href = 'index.html';
      }
    });
  }
  if ($('accountModalClose')) $('accountModalClose').addEventListener('click', () => accountModal.classList.add('hidden'));
  if (accountModal) accountModal.addEventListener('click', event => {
    if (event.target === accountModal) accountModal.classList.add('hidden');
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      closeProfileMenu();
      if (accountModal) accountModal.classList.add('hidden');
    }
  });
  if ($('ownerEmailLabel')) $('ownerEmailLabel').textContent = OWNER_EMAIL;
  renderGrounds(); renderBookings();
  let knownBookingIds = new Set(sampleBookings.map(b => b.id));
  window.addEventListener('storage', event => {
    if (event.key === NOTIFICATION_STORE) renderNotifications();
    if (event.key === STORE.grounds) { grounds = groundsForOwner(); renderGrounds(); }
    if (event.key === STORE.bookings) {
      const latest = bookingsForOwner();
      const incoming = latest.filter(b => !knownBookingIds.has(b.id));
      incoming.forEach(b => {
        toast('New booking request from ' + b.customer + ' for ' + b.ground + '.');
        if ('Notification' in window && Notification.permission === 'granted') {
          new Notification('New BoxBook booking request', {body: b.customer + ' · ' + b.ground + ' · ' + b.date + ' · ' + b.time});
        }
      });
      knownBookingIds = new Set(latest.map(b => b.id));
      renderBookings();
    }
  });
})();