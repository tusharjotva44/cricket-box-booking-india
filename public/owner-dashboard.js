(() => {
  const STORE = {grounds:'boxbook_grounds_v1', bookings:'boxbook_bookings_v1', plan:'boxbook_owner_plan_v1', planExpiry:'boxbook_owner_plan_expiry_v1'};
  const savedOwnerSession = (localStorage.getItem('boxbook_session_v1') || '').trim().toLowerCase();
  if (!savedOwnerSession) { window.location.replace('admin-login.html'); return; }
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
  let editingGroundId = null;
  let sampleBookings = bookingsForOwner();
  const saveGrounds = async () => {
    const { user, api, db } = await getOwnerFirebaseContext();
    await api.saveOwnerGrounds(db, user.uid, OWNER_EMAIL, grounds.map(g => ({...g, sportType:g.sport, owner:OWNER_EMAIL})));
    try {
      const all = readList(STORE.grounds).filter(g => g.owner !== OWNER_EMAIL);
      localStorage.setItem(STORE.grounds, JSON.stringify([...all, ...grounds.map(g => ({...g, sportType:g.sport, owner:OWNER_EMAIL}))]));
    } catch {}
  };
  const money = (n) => '₹' + Number(n || 0).toLocaleString('en-IN');
  const escapeHTML = (value='') => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function toast(message) {
    const el = $('toast'); el.textContent = message; el.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 2800);
  }
  function showView(name) {
    document.querySelectorAll('.view').forEach(view => view.classList.toggle('active', view.id === 'view-' + name));
    document.querySelectorAll('.nav-link').forEach(link => link.classList.toggle('active', link.dataset.view === name));
    const labels = {overview:'Overview',grounds:'My Grounds',availability:'Ground Availability',bookings:'Booking Control Center',calendar:'Booking Calendar',revenue:'Revenue Report',subscription:'Subscription'};
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
      (full ? '<td><div class="customer-cell"><strong>' + escapeHTML(b.customer) + '</strong><small class="booking-phone">' + escapeHTML(b.email || 'Not provided') + '</small></div></td><td>' + escapeHTML(b.ground) + '</td>' : '<td><div class="customer-cell"><strong>' + escapeHTML(b.customer) + '</strong></div></td>') +
      '<td>' + escapeHTML(b.date) + '<br><small>' + escapeHTML(b.time) + '</small></td><td>' + money(b.amount) + '</td><td><span class="status ' + (b.status === 'Confirmed' ? 'confirmed' : (b.status === 'Rejected' || b.status === 'Expired') ? 'rejected' : 'pending') + '">' + escapeHTML(b.status) + '</span>' + (b.paymentStatus ? '<br><small>' + escapeHTML(b.paymentStatus) + '</small>' : '') + '</td>' + (full ? '<td>' + (b.status === 'Pending' ? '<button type="button" class="approve-btn" data-approve="' + escapeHTML(b.id) + '">Approve</button> <button type="button" class="reject-btn" data-reject="' + escapeHTML(b.id) + '">Reject</button>' : '—') + '</td>' : '') + '</tr>';
  }
  function renderRevenueReport() {
    const period = $('revenuePeriod').value;
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    let start, end, previousStart, previousEnd;
    if (period === 'daily') {
      start = today; end = new Date(today); end.setDate(end.getDate() + 1);
      previousStart = new Date(start); previousStart.setDate(previousStart.getDate() - 1);
      previousEnd = new Date(start);
    } else if (period === 'weekly') {
      start = new Date(today);
      start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
      end = new Date(start); end.setDate(end.getDate() + 7);
      previousStart = new Date(start); previousStart.setDate(previousStart.getDate() - 7);
      previousEnd = new Date(start);
    } else {
      start = new Date(now.getFullYear(), now.getMonth(), 1);
      end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      previousStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      previousEnd = new Date(start);
    }
    const dateKey = date => date.getFullYear() + '-' + String(date.getMonth()+1).padStart(2,'0') + '-' + String(date.getDate()).padStart(2,'0');
    const startKey = dateKey(start), endKey = dateKey(end);
    const allConfirmed = bookingsForOwner().filter(b => b.status === 'Confirmed');
    const confirmed = allConfirmed.filter(b => b.date >= startKey && b.date < endKey);
    const previous = allConfirmed.filter(b => b.date >= dateKey(previousStart) && b.date < dateKey(previousEnd));
    const total = confirmed.reduce((sum,b) => sum + Number(b.amount || 0), 0);
    const previousTotal = previous.reduce((sum,b) => sum + Number(b.amount || 0), 0);
    $('reportRevenue').textContent = money(total);
    $('reportBookings').textContent = String(confirmed.length);
    $('reportAverage').textContent = money(confirmed.length ? Math.round(total / confirmed.length) : 0);
    const byGround = new Map();
    confirmed.forEach(b => {
      const key = b.ground || 'Ground';
      const item = byGround.get(key) || {count:0,total:0};
      item.count += 1; item.total += Number(b.amount || 0); byGround.set(key,item);
    });
    const rows = Array.from(byGround.entries()).sort((a,b) => b[1].total - a[1].total);
    $('reportTopGround').textContent = rows.length ? rows[0][0] : '—';
    $('reportTopGroundAmount').textContent = rows.length ? money(rows[0][1].total) + ' earnings' : 'No earnings yet';
    const growth = previousTotal === 0 ? (total > 0 ? 100 : 0) : ((total - previousTotal) / previousTotal) * 100;
    $('reportGrowth').textContent = (growth > 0 ? '+' : '') + growth.toFixed(1) + '%';
    $('reportGrowth').classList.toggle('is-positive', growth > 0);
    $('reportGrowth').classList.toggle('is-negative', growth < 0);
    $('reportGrowthCaption').textContent = 'Previous period: ' + money(previousTotal);
    $('revenueTrendCaption').textContent = period === 'daily' ? 'Hourly booking earnings today' : period === 'weekly' ? 'Daily earnings this week' : 'Daily earnings this month';
    const buckets = [];
    if (period === 'daily') {
      for (let hour=0; hour<24; hour+=3) buckets.push({label:String(hour).padStart(2,'0')+':00',start:new Date(start.getTime()+hour*3600000),end:new Date(start.getTime()+(hour+3)*3600000)});
    } else {
      const cursor = new Date(start);
      while (cursor < end) {
        const bucketStart = new Date(cursor), bucketEnd = new Date(cursor);
        bucketEnd.setDate(bucketEnd.getDate() + (period === 'weekly' ? 1 : 1));
        buckets.push({label:period === 'weekly' ? bucketStart.toLocaleDateString('en-IN',{weekday:'short'}) : String(bucketStart.getDate()),start:bucketStart,end:bucketEnd});
        cursor.setDate(cursor.getDate()+1);
      }
    }
    const bucketValues = buckets.map(bucket => {
      const key = dateKey(bucket.start), nextKey = dateKey(bucket.end);
      const amount = confirmed.filter(b => b.date >= key && b.date < nextKey && (period !== 'daily' || Number(String(b.time || '').match(/(\d{1,2})/)?.[1] || 0) >= Number(bucket.label.slice(0,2)) && Number(String(b.time || '').match(/(\d{1,2})/)?.[1] || 0) < Number(bucket.label.slice(0,2))+3)).reduce((sum,b) => sum + Number(b.amount || 0),0);
      return {...bucket,amount};
    });
    const maxValue = Math.max(1,...bucketValues.map(x=>x.amount));
    $('revenueTrendChart').innerHTML = bucketValues.map(bucket => '<div class="revenue-chart-column"><div class="revenue-chart-value">' + (bucket.amount ? money(bucket.amount) : '—') + '</div><div class="revenue-chart-track"><span style="height:' + Math.max(bucket.amount ? 5 : 0, bucket.amount/maxValue*100) + '%"></span></div><small>' + escapeHTML(bucket.label) + '</small></div>').join('');
    $('revenueGroundRows').innerHTML = rows.length
      ? rows.map(([name,item]) => '<tr><td>' + escapeHTML(name) + '</td><td>' + item.count + '</td><td>' + money(item.total) + '</td></tr>').join('')
      : '<tr><td colspan="3">No confirmed earnings for this period.</td></tr>';
    const sortedBookings = [...confirmed].sort((a,b) => String(b.date).localeCompare(String(a.date)) || String(b.id).localeCompare(String(a.id)));
    $('revenueBookingRows').innerHTML = sortedBookings.length
      ? sortedBookings.map(b => '<tr><td>' + escapeHTML(b.id) + '</td><td>' + escapeHTML(b.customer) + '</td><td>' + escapeHTML(b.ground) + '</td><td>' + escapeHTML(b.date) + '</td><td>' + money(b.amount) + '</td></tr>').join('')
      : '<tr><td colspan="5">No confirmed bookings for this period.</td></tr>';
  }
  function paymentIsReceived(paymentStatus) {
    const status = String(paymentStatus || '').trim().toLowerCase();
    return ['paid', 'received', 'payment received', 'success', 'successful', 'completed'].some(value => status === value || status.includes(value));
  }

  function paymentReceivedBookings() {
    return bookingsForOwner().filter(booking => paymentIsReceived(booking.paymentStatus))
      .sort((a,b) => String(b.date).localeCompare(String(a.date)) || String(b.id).localeCompare(String(a.id)));
  }

  function downloadPaymentReceivedCSV() {
    const paidBookings = paymentReceivedBookings();
    if (!paidBookings.length) { toast('No received payments available to download.'); return; }
    const columns = ['Booking ID','Customer','Phone','Ground','Booking Date','Time Slot','Amount','Payment Status'];
    const rows = paidBookings.map(booking => [booking.id,booking.customer,booking.email,booking.ground,booking.date,booking.time,booking.amount,booking.paymentStatus]);
    const csvCell = value => '"' + String(value ?? '').replace(/"/g,'""') + '"';
    const csv = '\uFEFF' + [columns,...rows].map(row => row.map(csvCell).join(',')).join('\r\n');
    const blob = new Blob([csv], {type:'text/csv;charset=utf-8;'});
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'box-book-india-payment-received-report-' + new Date().toISOString().slice(0,10) + '.csv';
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    toast('Payment report CSV downloaded.');
  }

  let calendarMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  let calendarSelectedDate = new Date().toISOString().slice(0,10);
  function renderBookingCalendar() {
    const grid = $('bookingCalendarGrid');
    if (!grid) return;
    const year = calendarMonth.getFullYear(), month = calendarMonth.getMonth();
    $('calendarMonthTitle').textContent = calendarMonth.toLocaleDateString('en-IN', {month:'long', year:'numeric'});
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const weekdays = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    const bookings = bookingsForOwner();
    const cells = weekdays.map(day => '<div class="calendar-weekday">' + day + '</div>');
    for (let i=0;i<firstDay;i++) cells.push('<div class="calendar-day is-empty" aria-hidden="true"></div>');
    for (let day=1;day<=daysInMonth;day++) {
      const date = year + '-' + String(month+1).padStart(2,'0') + '-' + String(day).padStart(2,'0');
      const dayBookings = bookings.filter(b => b.date === date);
      const confirmed = dayBookings.filter(b => b.status === 'Confirmed').length;
      const pending = dayBookings.filter(b => b.status === 'Pending').length;
      const other = dayBookings.length - confirmed - pending;
      cells.push('<button type="button" class="calendar-day' + (date===calendarSelectedDate?' is-selected':'') + (date===new Date().toISOString().slice(0,10)?' is-today':'') + '" data-calendar-date="' + date + '" aria-pressed="' + (date===calendarSelectedDate) + '"><span class="calendar-day-number">' + day + '</span>' + (dayBookings.length ? '<span class="calendar-day-count">' + dayBookings.length + ' booking' + (dayBookings.length===1?'':'s') + '</span><span class="calendar-day-dots">' + (confirmed?'<i class="confirmed"></i>':'') + (pending?'<i class="pending"></i>':'') + (other?'<i class="other"></i>':'') + '</span>' : '<span class="calendar-day-empty">—</span>') + '</button>');
    }
    grid.innerHTML = cells.join('');
    const selected = bookings.filter(b => b.date === calendarSelectedDate).sort((a,b) => String(a.time).localeCompare(String(b.time)));
    const selectedDate = new Date(calendarSelectedDate + 'T00:00:00');
    $('calendarSelectedTitle').textContent = selectedDate.toLocaleDateString('en-IN',{weekday:'long',day:'numeric',month:'long',year:'numeric'});
    $('calendarSelectedSummary').textContent = selected.length + (selected.length===1?' booking':' bookings') + ' on this date';
    $('calendarBookingRows').innerHTML = selected.length ? selected.map(b => '<tr><td><span class="booking-id">' + escapeHTML(b.id) + '</span></td><td>' + escapeHTML(b.customer) + '</td><td>' + escapeHTML(b.ground) + '</td><td>' + escapeHTML(b.time) + '</td><td>' + money(b.amount) + '</td><td><span class="status ' + (b.status==='Confirmed'?'confirmed':(b.status==='Rejected'||b.status==='Expired')?'rejected':'pending') + '">' + escapeHTML(b.status) + '</span></td></tr>').join('') : '<tr><td colspan="6">No bookings for this date.</td></tr>';
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
    renderRevenueReport();
    renderBookingCalendar();
  }
  async function getOwnerFirebaseContext() {
    if (!window.firebaseAuthApi || !window.firebaseAuth || !window.firebaseDB) {
      await new Promise((resolve, reject) => {
        const timeout = window.setTimeout(() => reject(new Error('Firebase is taking too long to load. Please refresh and try again.')), 10000);
        window.addEventListener('firebase-ready', () => {
          window.clearTimeout(timeout);
          resolve();
        }, { once: true });
      });
    }

    const api = window.firebaseAuthApi;
    const auth = window.firebaseAuth;
    if (!api || !auth || !window.firebaseDB) throw new Error('Firebase is not ready.');

    const user = await new Promise((resolve, reject) => {
      let unsubscribe = () => {};
      unsubscribe = api.onAuthStateChanged(auth, currentUser => {
        unsubscribe();
        resolve(currentUser);
      }, reject);
    });

    if (!user || !user.email || user.email.toLowerCase() !== OWNER_EMAIL) {
      throw new Error('Owner authentication required.');
    }
    return { user, api, db: window.firebaseDB };
  }

  function renderOwnerName() {
    const label = $('ownerGroundName');
    const avatar = document.querySelector('.profile-menu-trigger .avatar');
    let profile = {};
    try { profile = JSON.parse(localStorage.getItem('boxbook_owner_profile_v1') || '{}') || {}; } catch {}
    const ownerName = String(profile.yourName || profile.fullName || '').trim();
    if (label) label.textContent = ownerName || 'Owner Account';
    if (avatar) avatar.textContent = ownerName ? Array.from(ownerName)[0].toUpperCase() : 'O';
  }
  function renderGrounds() {
    $('statGrounds').textContent = String(grounds.length);
    if ($('availabilityGroundSelect')) renderAvailabilityGroundOptions();
    renderOwnerName();
    $('groundsGrid').innerHTML = grounds.map(g => '<article class="ground-card"><div class="ground-art">⌂</div><div class="ground-card-body"><span class="sport-tag">' + escapeHTML(g.sport.toUpperCase()) + '</span><h3 style="margin-top:11px">' + escapeHTML(g.name) + '</h3><p>⌖ ' + escapeHTML(g.location) + '<br>☎ ' + escapeHTML(g.mobile || g.phone || 'Mobile not provided') + '<br>' + escapeHTML(g.description || 'Sports ground available for booking.') + '</p><div class="ground-meta"><strong>' + money(g.price) + ' <small>/ hour</small></strong><span class="demo-pill">LIVE LISTING</span></div><div class="ground-actions"><small style="color:#9ca3af;font-size:10px">Visible to all visitors</small><div class="ground-action-buttons"><button class="secondary-btn" type="button" data-edit-ground="' + escapeHTML(g.id) + '">Edit</button><button class="delete-btn" data-delete="' + escapeHTML(g.id) + '">Remove</button></div></div></div></article>').join('');
    $('groundsEmpty').classList.toggle('hidden', grounds.length > 0);
    $('groundsGrid').classList.toggle('hidden', grounds.length === 0);
  }
  function groundLimit() {
    if (selectedPlan.startsWith('Free Trial') && getPlanExpiry() && new Date(getPlanExpiry()).getTime() <= Date.now()) return 0;
    return selectedPlan.includes('2 Grounds') ? 2 : selectedPlan.includes('1 Ground') ? 1 : 0;
  }
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
    const isTrial = selectedPlan.startsWith('Free Trial');
    const isExpired = !!expiryValue && new Date(expiryValue).getTime() <= Date.now();
    const expiryDetails = expiryText ? (isExpired ? 'Expired on ' + expiryText + '.' : 'Expires on ' + expiryText + ' (' + daysLeft + (daysLeft === 1 ? ' day left).' : ' days left).')) : '';
    $('planNoticeTitle').textContent = isExpired ? selectedPlan + ' — Expired' : selectedPlan + (isTrial ? ' — Active' : ' plan selected for preview');
    $('planNoticeText').textContent = isExpired
      ? 'Your 10-day free trial has expired. Choose a paid plan to continue adding grounds.'
      : (isTrial ? 'Your free trial is active for 10 days. ' : 'Demo mode: this plan allows up to ' + groundLimit() + (groundLimit() === 1 ? ' ground. ' : ' grounds. ')) + (expiryDetails ? expiryDetails : 'No expiry date is set.');
    $('dashboardPlanName').textContent = selectedPlan + (isExpired ? ' (Expired)' : isTrial ? ' (Active)' : '');
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
  const availabilityDays = [{key:'monday',label:'Monday'},{key:'tuesday',label:'Tuesday'},{key:'wednesday',label:'Wednesday'},{key:'thursday',label:'Thursday'},{key:'friday',label:'Friday'},{key:'saturday',label:'Saturday'},{key:'sunday',label:'Sunday'}];
  let availabilityGroundId = '';
  function defaultGroundAvailability() { return Object.fromEntries(availabilityDays.map(day => [day.key,{open:true,start:'08:00',end:'03:00'}])); }
  function renderAvailabilityGroundOptions() {
    const select = $('availabilityGroundSelect'), previous = availabilityGroundId;
    select.innerHTML = '<option value="">Select your ground</option>' + grounds.map(g => '<option value="' + escapeHTML(g.id) + '">' + escapeHTML(g.name) + '</option>').join('');
    availabilityGroundId = grounds.some(g => g.id === previous) ? previous : (grounds[0] ? grounds[0].id : '');
    select.value = availabilityGroundId; renderAvailabilityEditor();
  }
  function renderAvailabilityEditor() {
    const ground = grounds.find(g => g.id === availabilityGroundId), editor = $('availabilityEditor'), actions = $('availabilityActions');
    if (!ground) { editor.innerHTML = '<p class="availability-empty">' + (grounds.length ? 'Select a ground to set its weekly schedule.' : 'Add a ground first to manage its availability.') + '</p>'; actions.classList.add('hidden'); return; }
    const schedule = {...defaultGroundAvailability(),...(ground.availability || {})};
    editor.innerHTML = '<div class="availability-ground-summary"><strong>' + escapeHTML(ground.name) + '</strong><span>' + escapeHTML(ground.sport) + ' · ' + escapeHTML(ground.location) + '</span></div><div class="availability-week">' + availabilityDays.map(day => {
      const item = schedule[day.key] || {open:false,start:'08:00',end:'03:00'};
      const today = new Date();
      const weekDate = new Date(today.getFullYear(), today.getMonth(), today.getDate() - ((today.getDay() + 6) % 7) + availabilityDays.indexOf(day));
      const dateLabel = weekDate.toLocaleDateString('en-IN', {day:'numeric',month:'short'});
      return '<div class="availability-day-row" data-availability-day="' + day.key + '"><label class="availability-day-toggle"><input type="checkbox" data-availability-open ' + (item.open ? 'checked' : '') + '><span>' + day.label + '<small class="availability-date">' + dateLabel + '</small></span></label><label class="availability-time-field">From<input type="time" data-availability-start value="' + escapeHTML(item.start || '08:00') + '" ' + (!item.open?'disabled':'') + '></label><label class="availability-time-field">Until<input type="time" data-availability-end value="' + escapeHTML(item.end || '03:00') + '" ' + (!item.open?'disabled':'') + '></label><span class="availability-closed-label">' + (item.open?'Open':'Closed') + '</span></div>';
    }).join('') + '</div><p class="availability-note">Switch off a day to close the ground. Overnight hours are supported, for example 8:00 AM to 3:00 AM.</p>';
    actions.classList.remove('hidden');
  }
  $('availabilityGroundSelect').addEventListener('change', () => { availabilityGroundId = $('availabilityGroundSelect').value; renderAvailabilityEditor(); });
  $('availabilityEditor').addEventListener('change', event => {
    const row = event.target.closest('[data-availability-day]');
    if (!row || !event.target.matches('[data-availability-open]')) return;
    const open = event.target.checked;
    row.querySelector('[data-availability-start]').disabled = !open;
    row.querySelector('[data-availability-end]').disabled = !open;
    row.querySelector('.availability-closed-label').textContent = open ? 'Open' : 'Closed';
  });
  $('saveAvailabilityButton').addEventListener('click', () => {
    const ground = grounds.find(g => g.id === availabilityGroundId);
    if (!ground) { toast('Please select a ground.'); return; }
    const schedule = {}; let valid = true;
    document.querySelectorAll('[data-availability-day]').forEach(row => {
      const key = row.dataset.availabilityDay, open = row.querySelector('[data-availability-open]').checked;
      const start = row.querySelector('[data-availability-start]').value, end = row.querySelector('[data-availability-end]').value;
      if (open && (!start || !end || start === end)) valid = false;
      schedule[key] = {open,start,end};
    });
    if (!valid) { toast('For each open day, choose different start and end times.'); return; }
    ground.availability = schedule;
    saveGrounds().then(() => { toast('Ground availability saved.'); renderAvailabilityEditor(); }).catch(() => toast('Could not save availability. Please try again.'));
  });
  document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => showView(button.dataset.view)));
  $('calendarPrev').addEventListener('click', () => { calendarMonth = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth()-1, 1); renderBookingCalendar(); });
  $('calendarNext').addEventListener('click', () => { calendarMonth = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth()+1, 1); renderBookingCalendar(); });
  $('calendarToday').addEventListener('click', () => { const today = new Date(); calendarMonth = new Date(today.getFullYear(),today.getMonth(),1); calendarSelectedDate = today.toISOString().slice(0,10); renderBookingCalendar(); });
  $('bookingCalendarGrid').addEventListener('click', event => {
    const day = event.target.closest('[data-calendar-date]');
    if (!day) return;
    calendarSelectedDate = day.dataset.calendarDate;
    renderBookingCalendar();
  });
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
  ['cancelGroundForm','cancelGroundForm2'].forEach(id => $(id).addEventListener('click', () => { resetGroundForm(); $('groundFormPanel').classList.add('hidden'); }));
  function resetGroundForm() {
    editingGroundId = null;
    $('groundForm').reset();
    $('groundFormTitle').textContent = 'Add a ground';
    $('groundFormDescription').textContent = 'Add your ground details.';
    $('groundFormSubmit').textContent = 'Save Ground';
  }
  function editGround(groundId) {
    const ground = grounds.find(item => item.id === groundId);
    if (!ground) return;
    editingGroundId = groundId;
    $('groundName').value = ground.name || '';
    $('groundSport').value = ground.sport || ground.sportType || 'Box Cricket';
    $('groundLocation').value = ground.location || '';
    $('groundMobile').value = ground.mobile || ground.phone || '';
    $('groundPrice').value = ground.price || '';
    $('groundUpiId').value = ground.upiId || '';
    $('groundQrImageUrl').value = ground.qrImageUrl || '';
    $('groundDescription').value = ground.description || '';
    $('groundFormTitle').textContent = 'Edit ground details';
    $('groundFormDescription').textContent = 'Update your ground details.';
    $('groundFormSubmit').textContent = 'Update Ground';
    $('groundFormPanel').classList.remove('hidden');
    $('groundFormPanel').scrollIntoView({behavior:'smooth',block:'start'});
  }
  $('groundForm').addEventListener('submit', async event => {
    event.preventDefault();
    const name = $('groundName').value.trim(), location = $('groundLocation').value.trim(), mobile = $('groundMobile').value.trim(), price = Number($('groundPrice').value);
    if (!name || !location || !/^[0-9]{10}$/.test(mobile) || !Number.isFinite(price) || price < 1) { toast('Enter valid ground details and a 10-digit mobile number.'); return; }
    const updatedFields = {name,sport:$('groundSport').value,sportType:$('groundSport').value,location,mobile,phone:mobile,price,upiId:$('groundUpiId').value.trim(),qrImageUrl:$('groundQrImageUrl').value.trim(),description:$('groundDescription').value.trim()};
    if (editingGroundId) {
      const index = grounds.findIndex(g => g.id === editingGroundId);
      if (index < 0) { toast('Ground could not be found.'); resetGroundForm(); return; }
      grounds[index] = {...grounds[index],...updatedFields};
      try { await saveGrounds(); renderGrounds(); resetGroundForm(); $('groundFormPanel').classList.add('hidden'); toast('Ground details updated and synced.'); }
      catch (error) { toast('Ground update failed. Check your connection and try again.'); }
      return;
    }
    const limit = groundLimit();
    if (!limit) { toast('Please select a plan before adding a ground.'); showView('subscription'); return; }
    if (grounds.length >= limit) { toast('Your selected plan allows up to ' + limit + (limit === 1 ? ' ground.' : ' grounds.') + ' Choose a 2 Grounds plan to add another.'); showView('subscription'); return; }
    const newGround = {id:'ground-' + Date.now(),...updatedFields,owner:OWNER_EMAIL,slots:[]};
    grounds.push(newGround);
    try { await saveGrounds(); renderGrounds(); resetGroundForm(); $('groundFormPanel').classList.add('hidden'); toast('Ground added and shared with all visitors.'); }
    catch (error) { grounds = grounds.filter(g => g.id !== newGround.id); renderGrounds(); toast('Ground could not be synced. Please try again.'); }
  });
  $('groundsGrid').addEventListener('click', async event => {
    const editButton = event.target.closest('[data-edit-ground]');
    if (editButton) { editGround(editButton.dataset.editGround); return; }
    const button = event.target.closest('[data-delete]'); if (!button) return;
    const previous = grounds;
    grounds = grounds.filter(g => g.id !== button.dataset.delete);
    try { await saveGrounds(); renderGrounds(); toast('Ground removed from the live listing.'); }
    catch (error) { grounds = previous; renderGrounds(); toast('Could not remove ground. Please try again.'); }
  });
  function timeLabel(value) {
    const [hour, minute] = value.split(':').map(Number);
    const suffix = hour >= 12 ? 'PM' : 'AM';
    return (hour % 12 || 12) + ':' + String(minute).padStart(2, '0') + ' ' + suffix;
  }
  function populateOwnerBookingGrounds() {
    const select = $('ownerBookingGround');
    select.innerHTML = '<option value="">Select your ground</option>' + grounds.map(g => '<option value="' + escapeHTML(g.id) + '">' + escapeHTML(g.name) + ' · ' + escapeHTML(g.sport) + '</option>').join('');
  }
  function populateOwnerBookingTimes() {
    const start = $('ownerBookingStart'), end = $('ownerBookingEnd');
    const options = [];
    for (let minute = 8 * 60; minute <= 27 * 60; minute += 30) {
      const normalized = minute % 1440;
      const value = String(Math.floor(normalized / 60)).padStart(2, '0') + ':' + String(normalized % 60).padStart(2, '0');
      options.push({value, label:timeLabel(value)});
    }
    start.innerHTML = '<option value="">Select start time</option>' + options.filter(x => Number(x.value.slice(0,2)) >= 8 || Number(x.value.slice(0,2)) < 3).map(x => '<option value="' + x.value + '">' + x.label + '</option>').join('');
    end.innerHTML = '<option value="">Select end time</option>';
  }
  function updateOwnerBookingEndOptions() {
    const startValue = $('ownerBookingStart').value;
    const end = $('ownerBookingEnd');
    const startMinutes = timeMinutes(startValue);
    if (startMinutes === null) { end.innerHTML = '<option value="">Select end time</option>'; $('ownerBookingAmount').value = ''; return; }
    const options = [];
    for (let duration = 30; duration <= 8 * 60; duration += 30) {
      const absolute = startMinutes + duration;
      if (absolute > 27 * 60) break;
      const value = String(Math.floor((absolute % 1440) / 60)).padStart(2, '0') + ':' + String(absolute % 60).padStart(2, '0');
      options.push('<option value="' + value + '">' + timeLabel(value) + '</option>');
    }
    end.innerHTML = '<option value="">Select end time</option>' + options.join('');
    $('ownerBookingAmount').value = '';
  }
  function updateOwnerBookingAmount() {
    const ground = grounds.find(g => g.id === $('ownerBookingGround').value);
    const start = timeMinutes($('ownerBookingStart').value), end = timeMinutes($('ownerBookingEnd').value);
    if (!ground || start === null || end === null) { $('ownerBookingAmount').value = ''; return; }
    const duration = end > start ? end - start : end + 1440 - start;
    $('ownerBookingAmount').value = Math.round(Number(ground.price || 0) * duration / 60);
  }
  function openOwnerBookingForm() {
    if (!grounds.length) { showView('grounds'); toast('Please add a ground before creating a booking.'); return; }
    $('ownerBookingForm').reset();
    populateOwnerBookingGrounds();
    populateOwnerBookingTimes();
    $('ownerBookingDate').min = new Date().toISOString().slice(0, 10);
    $('ownerBookingDate').value = $('ownerBookingDate').min;
    $('ownerBookingFormPanel').classList.remove('hidden');
    $('ownerBookingFormPanel').scrollIntoView({behavior:'smooth',block:'start'});
  }
  $('showOwnerBookingForm').addEventListener('click', openOwnerBookingForm);
  $('dashboardNewBookingButton').addEventListener('click', () => { showView('bookings'); openOwnerBookingForm(); });
  ['cancelOwnerBookingForm','cancelOwnerBookingForm2'].forEach(id => $(id).addEventListener('click', () => $('ownerBookingFormPanel').classList.add('hidden')));
  $('ownerBookingStart').addEventListener('change', () => { updateOwnerBookingEndOptions(); updateOwnerBookingAmount(); });
  ['ownerBookingGround','ownerBookingEnd'].forEach(id => $(id).addEventListener('change', updateOwnerBookingAmount));
  $('ownerBookingForm').addEventListener('submit', event => {
    event.preventDefault();
    const ground = grounds.find(g => g.id === $('ownerBookingGround').value);
    const customerName = $('ownerBookingCustomer').value.trim();
    const phone = $('ownerBookingPhone').value.trim();
    const date = $('ownerBookingDate').value;
    const startTime = $('ownerBookingStart').value;
    const endTime = $('ownerBookingEnd').value;
    if (!ground) { toast('Please select one of your grounds.'); return; }
    if (!customerName) { toast('Enter the customer name.'); return; }
    if (!/^[0-9]{10}$/.test(phone)) { toast('Enter a valid 10-digit mobile number.'); return; }
    if (!date || date < new Date().toISOString().slice(0, 10)) { toast('Choose today or a future date.'); return; }
    const start = timeMinutes(startTime), finish = timeMinutes(endTime);
    if (start === null || finish === null || (finish <= start && !(finish + 1440 > start))) { toast('Choose a valid start and end time.'); return; }
    const duration = finish > start ? finish - start : finish + 1440 - start;
    if (duration > 8 * 60) { toast('A booking can be up to 8 hours.'); return; }
    const slot = timeLabel(startTime) + ' - ' + timeLabel(endTime);
    const booking = {id:'OWN-' + Date.now(), groundId:ground.id, groundName:ground.name, customerName, phone, date, slot, startTime, endTime, amount:Math.round(Number(ground.price || 0) * duration / 60), owner:OWNER_EMAIL, status:'Confirmed', paymentStatus:'Pay at venue', bookingSource:'Owner dashboard', createdAt:Date.now()};
    const allBookings = readList(STORE.bookings);
    if (allBookings.some(existing => existing.groundId === ground.id && existing.date === date && existing.status !== 'Rejected' && existing.status !== 'Expired' && existing.status !== 'Cancelled' && overlaps(booking, existing))) {
      toast('This time overlaps an existing booking. Choose another slot.');
      return;
    }
    try {
      allBookings.push(booking);
      localStorage.setItem(STORE.bookings, JSON.stringify(allBookings));
    } catch {
      toast('Could not save this booking in this browser.');
      return;
    }
    $('ownerBookingFormPanel').classList.add('hidden');
    renderBookings();
    toast('Booking confirmed and added to your bookings.');
  });
  $('revenuePeriod').addEventListener('change', renderRevenueReport);
  $('downloadPaymentReport').addEventListener('click', downloadPaymentReceivedCSV);
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
  (async () => {
    try {
      const { user, api, db } = await getOwnerFirebaseContext();
      const profile = await api.getOwnerProfile(db, user.uid);
      if (!profile || profile.planName !== 'Free Trial - 1 Ground' || !profile.trialStartedAt || !profile.trialExpiresAt) return;
      selectedPlan = profile.planName;
      const plans = JSON.parse(localStorage.getItem(STORE.plan) || '{}');
      plans[OWNER_EMAIL] = selectedPlan;
      localStorage.setItem(STORE.plan, JSON.stringify(plans));
      const dates = JSON.parse(localStorage.getItem(STORE.planExpiry) || '{}');
      dates[OWNER_EMAIL] = profile.trialExpiresAt;
      localStorage.setItem(STORE.planExpiry, JSON.stringify(dates));
      syncPlanPreview();
    } catch (error) {
      console.error('Could not load owner trial status:', error);
      toast('Could not load your trial status. Please refresh.');
    }
  })();
  let bookingAlertAudioContext = null;
  function enableBookingAlerts() {
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (AudioContextClass) {
        if (!bookingAlertAudioContext) bookingAlertAudioContext = new AudioContextClass();
        if (bookingAlertAudioContext.state === 'suspended') bookingAlertAudioContext.resume();
      }
    } catch {}
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().then(permission => {
        if (permission === 'granted') toast('Browser booking notifications enabled.');
        else toast('Browser notifications are blocked. You can allow them in site settings.');
      }).catch(() => {});
    } else if (!('Notification' in window)) {
      toast('This browser does not support desktop notifications.');
    }
  }
  function playBookingAlertSound() {
    if (!bookingAlertAudioContext || bookingAlertAudioContext.state !== 'running') return;
    try {
      const now = bookingAlertAudioContext.currentTime;
      [0, 0.28].forEach(offset => {
        const oscillator = bookingAlertAudioContext.createOscillator();
        const gain = bookingAlertAudioContext.createGain();
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(880, now + offset);
        gain.gain.setValueAtTime(0.0001, now + offset);
        gain.gain.exponentialRampToValueAtTime(0.18, now + offset + 0.025);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.18);
        oscillator.connect(gain);
        gain.connect(bookingAlertAudioContext.destination);
        oscillator.start(now + offset);
        oscillator.stop(now + offset + 0.19);
      });
    } catch {}
  }
  const notificationTrigger = $('notificationTrigger');
  const notificationPanel = $('notificationPanel');
  if (notificationTrigger && notificationPanel) {
    notificationTrigger.addEventListener('click', () => {
      enableBookingAlerts();
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
    profileDropdown.addEventListener('click', async event => {
      const button = event.target.closest('[data-profile-action]');
      if (!button) return;
      const action = button.dataset.profileAction;
      if (action === 'profile') {
        closeProfileMenu();
        (async () => {
          try {
            const { user, api, db } = await getOwnerFirebaseContext();
            const savedProfile = await api.getOwnerProfile(db, user.uid) || {};
            let cachedProfile = {};
            try { cachedProfile = JSON.parse(localStorage.getItem('boxbook_owner_profile_v1') || '{}') || {}; } catch {}
            const fullName = String(savedProfile.fullName || savedProfile.yourName || cachedProfile.yourName || cachedProfile.fullName || '');
            const mobile = String(savedProfile.mobile || cachedProfile.mobile || '');
            const email = user.email || OWNER_EMAIL;

            openAccountModal('My Profile', 'OWNER ACCOUNT',
              '<form id="ownerProfileForm" class="owner-profile-form">' +
              '<label>Full name<input name="fullName" type="text" maxlength="70" required value="' + escapeHTML(fullName) + '"></label>' +
              '<label>Mobile number<input name="mobile" type="tel" inputmode="numeric" maxlength="10" minlength="10" pattern="[0-9]{10}" required value="' + escapeHTML(mobile) + '"></label>' +
              '<label>Email address<input name="email" type="email" readonly value="' + escapeHTML(email) + '"></label>' +
              '<p class="account-modal-note" id="ownerProfileMessage" role="status">Your profile details are connected to your account.</p>' +
              '<div class="account-modal-actions"><button type="submit" id="ownerProfileSave">Save Changes</button></div></form>');

            const profileForm = $('ownerProfileForm');
            const profileMessage = $('ownerProfileMessage');
            const profileSave = $('ownerProfileSave');
            profileForm.querySelector('[name="mobile"]').addEventListener('input', event => {
              event.target.value = event.target.value.replace(/\D/g, '').slice(0, 10);
            });
            profileForm.addEventListener('submit', async submitEvent => {
              submitEvent.preventDefault();
              const formData = new FormData(profileForm);
              const updatedName = String(formData.get('fullName') || '').trim();
              const updatedMobile = String(formData.get('mobile') || '').trim();
              if (!updatedName) {
                profileMessage.textContent = 'Please enter your full name.';
                return;
              }
              if (!/^[0-9]{10}$/.test(updatedMobile)) {
                profileMessage.textContent = 'Please enter a valid 10-digit mobile number.';
                return;
              }
              profileSave.disabled = true;
              profileSave.textContent = 'Saving...';
              profileMessage.textContent = 'Saving your profile...';
              try {
                const profileData = { fullName: updatedName, mobile: updatedMobile, email };
                if (Object.keys(savedProfile).length) {
                  await api.updateOwnerProfile(db, user.uid, profileData);
                } else {
                  await api.saveOwnerProfile(db, user.uid, profileData);
                }
                localStorage.setItem('boxbook_owner_profile_v1', JSON.stringify({
                  yourName: updatedName,
                  fullName: updatedName,
                  mobile: updatedMobile,
                  email
                }));
                profileMessage.textContent = 'Profile updated successfully.';
                profileMessage.style.color = '#15803d';
                renderOwnerName();
                profileSave.textContent = 'Saved';
              } catch (error) {
                profileMessage.textContent = 'Profile could not be saved. Please check your connection and try again.';
                profileSave.disabled = false;
                profileSave.textContent = 'Save Changes';
              }
            });
          } catch (error) {
            toast(error && error.message ? error.message : 'Could not load your profile. Please try again.');
          }
        })();
      } else if (action === 'plan') {
        closeProfileMenu();
        showView('subscription');
      } else if (action === 'password') {
        openAccountModal('Change Password', 'ACCOUNT SECURITY',
          '<form id="passwordChangeForm" class="owner-profile-form">' +
          '<label>Current password<input name="currentPassword" type="password" autocomplete="current-password" required></label>' +
          '<label>New password<input name="newPassword" type="password" autocomplete="new-password" minlength="6" required></label>' +
          '<label>Confirm new password<input name="confirmPassword" type="password" autocomplete="new-password" minlength="6" required></label>' +
          '<p class="account-modal-note" id="passwordChangeMessage" role="status">Use at least 6 characters for your new password.</p>' +
          '<div class="account-modal-actions"><button type="submit" id="passwordChangeSubmit">Update Password</button></div></form>');
        const passwordForm = $('passwordChangeForm');
        const passwordMessage = $('passwordChangeMessage');
        const passwordSubmit = $('passwordChangeSubmit');
        passwordForm.addEventListener('submit', async event => {
          event.preventDefault();
          const formData = new FormData(passwordForm);
          const currentPassword = String(formData.get('currentPassword') || '');
          const newPassword = String(formData.get('newPassword') || '');
          const confirmPassword = String(formData.get('confirmPassword') || '');
          if (newPassword.length < 6) {
            passwordMessage.textContent = 'New password must be at least 6 characters.';
            return;
          }
          if (newPassword !== confirmPassword) {
            passwordMessage.textContent = 'New password and confirmation do not match.';
            return;
          }
          if (currentPassword === newPassword) {
            passwordMessage.textContent = 'Choose a new password different from your current password.';
            return;
          }
          const auth = window.firebaseAuth;
          const api = window.firebaseAuthApi;
          const user = auth && auth.currentUser;
          if (!user || !user.email || !api || typeof api.reauthenticateWithCredential !== 'function' ||
              typeof api.EmailAuthProvider !== 'function' || typeof api.updatePassword !== 'function') {
            passwordMessage.textContent = 'Your secure login is not ready. Please sign out and sign in again, then retry.';
            return;
          }
          passwordSubmit.disabled = true;
          passwordSubmit.textContent = 'Updating...';
          passwordMessage.textContent = 'Verifying your current password...';
          try {
            const credential = api.EmailAuthProvider.credential(user.email, currentPassword);
            await api.reauthenticateWithCredential(user, credential);
            await api.updatePassword(user, newPassword);
            passwordMessage.textContent = 'Password updated successfully.';
            passwordMessage.style.color = '#15803d';
            passwordForm.reset();
            passwordSubmit.textContent = 'Updated';
            setTimeout(() => accountModal.classList.add('hidden'), 1100);
          } catch (error) {
            const code = error && error.code;
            if (code === 'auth/wrong-password' || code === 'auth/invalid-credential') {
              passwordMessage.textContent = 'Current password is incorrect. Please try again.';
            } else if (code === 'auth/weak-password') {
              passwordMessage.textContent = 'Choose a stronger password with at least 6 characters.';
            } else if (code === 'auth/requires-recent-login') {
              passwordMessage.textContent = 'For security, sign out and sign in again before changing your password.';
            } else if (code === 'auth/network-request-failed') {
              passwordMessage.textContent = 'Network error. Check your internet connection and try again.';
            } else {
              passwordMessage.textContent = 'Password could not be updated. Please try again.';
            }
            passwordSubmit.disabled = false;
            passwordSubmit.textContent = 'Update Password';
          }
        });
      } else if (action === 'logout') {
        closeProfileMenu();
        (async () => {
          try {
            if (!window.firebaseAuthApi || !window.firebaseAuth || typeof window.firebaseAuthApi.signOut !== 'function') {
              throw new Error('Firebase logout is not ready.');
            }
            await window.firebaseAuthApi.signOut(window.firebaseAuth);
            localStorage.removeItem('boxbook_session_v1');
            window.location.replace('admin-login.html');
          } catch (error) {
            toast('Logout failed. Please try again.');
          }
        })();
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
  (async () => {
    try {
      const { user, api, db } = await getOwnerFirebaseContext();
      const remoteGrounds = await api.getOwnerGrounds(db, user.uid);
      if (remoteGrounds.length) {
        grounds = remoteGrounds.map(g => ({...g, sport:g.sport || g.sportType || 'Box Cricket', location:g.location || '', price:Number(g.price || 0)}));
      } else if (grounds.length) {
        await api.saveOwnerGrounds(db, user.uid, OWNER_EMAIL, grounds.map(g => ({...g, sportType:g.sport, owner:OWNER_EMAIL})));
      }
      renderGrounds();
    } catch (error) {
      console.error('Ground sync failed:', error);
      toast('Ground sync failed. Please refresh or check Firebase permissions.');
    }
  })();
  let knownBookingIds = new Set(sampleBookings.map(b => b.id));
  window.addEventListener('storage', event => {
    if (event.key === NOTIFICATION_STORE) renderNotifications();
    if (event.key === STORE.grounds) { grounds = groundsForOwner(); renderGrounds(); }
    if (event.key === STORE.bookings) {
      const latest = bookingsForOwner();
      const incoming = latest.filter(b => !knownBookingIds.has(b.id));
      incoming.forEach(b => {
        toast('New booking request from ' + b.customer + ' for ' + b.ground + '.');
        playBookingAlertSound();
        if ('Notification' in window && Notification.permission === 'granted') {
          new Notification('New BoxBook booking request', {body: b.customer + ' · ' + b.ground + ' · ' + b.date + ' · ' + b.time, tag: String(b.id || 'boxbook-booking')});
        }
      });
      knownBookingIds = new Set(latest.map(b => b.id));
      renderBookings();
    }
  });
})();