(() => {
  const STORE = {grounds:'boxbook_grounds_v1', bookings:'boxbook_bookings_v1'};
  const OWNER_EMAIL = 'demo@boxbook.in';
  const $ = (id) => document.getElementById(id);
  const readList = (key) => { try { const data = JSON.parse(localStorage.getItem(key)); return Array.isArray(data) ? data : []; } catch { return []; } };
  const groundsForOwner = () => readList(STORE.grounds).filter(g => g.owner === OWNER_EMAIL).map(g => ({...g, sport:g.sportType || g.sport || 'Box Cricket', location:g.location || [g.area,g.city].filter(Boolean).join(', '), price:Number(g.price || 0)}));
  const bookingsForOwner = () => readList(STORE.bookings).filter(b => b.owner === OWNER_EMAIL).map(b => ({id:b.id, customer:b.customerName || 'Customer', email:b.phone || '', ground:b.groundName || 'Ground', date:b.date || '', time:b.slot || '', amount:0, status:'Confirmed'}));
  let selectedPlan = '';
  let toastTimer;
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
    const labels = {overview:'Overview',grounds:'My Grounds',bookings:'Bookings',subscription:'Subscription'};
    $('breadcrumbTitle').textContent = labels[name] || 'Overview';
    $('sidebar').classList.remove('open');
    window.scrollTo({top:0,behavior:'smooth'});
  }
  function bookingRow(b, full=false) {
    return '<tr><td><span class="booking-id">' + escapeHTML(b.id) + '</span></td>' +
      (full ? '<td><div class="customer-cell"><strong>' + escapeHTML(b.customer) + '</strong><small>' + escapeHTML(b.email) + '</small></div></td><td>' + escapeHTML(b.ground) + '</td>' : '') +
      '<td>' + escapeHTML(b.date) + '<br><small>' + escapeHTML(b.time) + '</small></td><td>' + money(b.amount) + '</td><td><span class="status ' + (b.status === 'Confirmed' ? 'confirmed' : 'pending') + '">' + escapeHTML(b.status) + '</span></td></tr>';
  }
  function renderBookings() {
    sampleBookings = bookingsForOwner();
    const filter = $('bookingFilter').value;
    const list = sampleBookings.filter(b => filter === 'all' || b.status === filter);
    $('bookingRows').innerHTML = list.length ? list.map(b => bookingRow(b, true)).join('') : '<tr><td colspan="6">No bookings match this filter.</td></tr>';
    $('recentBookingRows').innerHTML = sampleBookings.slice(0, 2).map(b => bookingRow(b, false)).join('');
    $('statBookings').textContent = String(sampleBookings.length);
    $('bookingCount').textContent = String(sampleBookings.filter(b => b.status === 'Pending').length);
    $('statRevenue').textContent = money(sampleBookings.filter(b => b.status === 'Confirmed').reduce((sum,b) => sum + b.amount, 0));
  }
  function renderGrounds() {
    $('statGrounds').textContent = String(grounds.length);
    $('groundsGrid').innerHTML = grounds.map(g => '<article class="ground-card"><div class="ground-art">⌂</div><div class="ground-card-body"><span class="sport-tag">' + escapeHTML(g.sport.toUpperCase()) + '</span><h3 style="margin-top:11px">' + escapeHTML(g.name) + '</h3><p>⌖ ' + escapeHTML(g.location) + '<br>' + escapeHTML(g.description || 'Sports ground available for booking.') + '</p><div class="ground-meta"><strong>' + money(g.price) + ' <small>/ hour</small></strong><span class="demo-pill">DEMO LISTING</span></div><div class="ground-actions"><small style="color:#9ca3af;font-size:10px">Shared browser demo</small><button class="delete-btn" data-delete="' + escapeHTML(g.id) + '">Remove</button></div></div></div>').join('');
    $('groundsEmpty').classList.toggle('hidden', grounds.length > 0);
    $('groundsGrid').classList.toggle('hidden', grounds.length === 0);
  }
  function openGroundForm() { $('groundFormPanel').classList.remove('hidden'); $('groundFormPanel').scrollIntoView({behavior:'smooth',block:'start'}); }
  document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => showView(button.dataset.view)));
  document.querySelectorAll('[data-go]').forEach(button => button.addEventListener('click', () => { showView(button.dataset.go); if (button.dataset.go === 'grounds') openGroundForm(); }));
  $('menuToggle').addEventListener('click', () => $('sidebar').classList.toggle('open'));
  $('showGroundForm').addEventListener('click', openGroundForm);
  document.querySelectorAll('[data-open-form]').forEach(button => button.addEventListener('click', openGroundForm));
  ['cancelGroundForm','cancelGroundForm2'].forEach(id => $(id).addEventListener('click', () => $('groundFormPanel').classList.add('hidden')));
  $('groundForm').addEventListener('submit', event => {
    event.preventDefault();
    const name = $('groundName').value.trim(), location = $('groundLocation').value.trim(), price = Number($('groundPrice').value);
    if (!name || !location || !Number.isFinite(price) || price < 1) { toast('Please check the ground details.'); return; }
    if (grounds.length >= 2) { toast('Demo limit reached: maximum 2 grounds in this preview.'); return; }
    grounds.push({id:'ground-' + Date.now(),name,sport:$('groundSport').value,sportType:$('groundSport').value,location,price,description:$('groundDescription').value.trim(),owner:OWNER_EMAIL,slots:[]});
    saveGrounds(); renderGrounds(); $('groundForm').reset(); $('groundFormPanel').classList.add('hidden'); toast('Ground added to this browser demo.');
  });
  $('groundsGrid').addEventListener('click', event => {
    const button = event.target.closest('[data-delete]'); if (!button) return;
    grounds = grounds.filter(g => g.id !== button.dataset.delete); saveGrounds(); renderGrounds(); toast('Demo ground removed from the shared listing.');
  });
  $('bookingFilter').addEventListener('change', renderBookings);
  document.querySelectorAll('.plan-select').forEach(button => button.addEventListener('click', () => {
    selectedPlan = button.dataset.plan;
    $('planNoticeTitle').textContent = selectedPlan + ' plan selected for preview';
    $('planNoticeText').textContent = 'This is a demo selection only. No subscription has been activated and no payment has been taken.';
    document.querySelectorAll('.plan-select').forEach(b => { b.textContent = b.dataset.plan === selectedPlan ? 'Selected for preview' : 'Select ' + b.dataset.plan; });
    toast(selectedPlan + ' plan selected in demo mode.');
  }));
  renderGrounds(); renderBookings();
  window.addEventListener('storage', event => { if (event.key === STORE.grounds) { grounds = groundsForOwner(); renderGrounds(); } if (event.key === STORE.bookings) renderBookings(); });
})();