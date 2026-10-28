(() => {
  const STORE_KEY = 'boxbook_owner_dashboard_demo_grounds_v1';
  const $ = (id) => document.getElementById(id);
  const sampleBookings = [
    {id:'BB-1042',customer:'Aarav Patel',email:'aarav@example.test',ground:'Sunrise Box Arena',date:'28 Oct 2026',time:'06:00 PM – 07:00 PM',amount:1200,status:'Confirmed'},
    {id:'BB-1041',customer:'Mira Shah',email:'mira@example.test',ground:'Sunrise Box Arena',date:'29 Oct 2026',time:'07:00 PM – 08:00 PM',amount:1200,status:'Pending'}
  ];
  const baseGrounds = [{id:'sample-ground',name:'Sunrise Box Arena',sport:'Box Cricket',location:'Ahmedabad, Gujarat',price:1200,description:'A sample cricket venue with evening slots and a welcoming playing space.'}];
  let selectedPlan = '';
  let toastTimer;
  const readGrounds = () => {
    try { const data = JSON.parse(localStorage.getItem(STORE_KEY)); return Array.isArray(data) ? data : baseGrounds; }
    catch { return baseGrounds; }
  };
  let grounds = readGrounds();
  const saveGrounds = () => { try { localStorage.setItem(STORE_KEY, JSON.stringify(grounds)); } catch {} };
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
    $('groundsGrid').innerHTML = grounds.map(g => '<article class="ground-card"><div class="ground-art">⌂</div><div class="ground-card-body"><span class="sport-tag">' + escapeHTML(g.sport.toUpperCase()) + '</span><h3 style="margin-top:11px">' + escapeHTML(g.name) + '</h3><p>⌖ ' + escapeHTML(g.location) + '<br>' + escapeHTML(g.description || 'Sports ground available for booking.') + '</p><div class="ground-meta"><strong>' + money(g.price) + ' <small>/ hour</small></strong><span class="demo-pill">DEMO LISTING</span></div><div class="ground-actions"><small style="color:#9ca3af;font-size:10px">Browser preview</small>' + (g.id !== 'sample-ground' ? '<button class="delete-btn" data-delete="' + escapeHTML(g.id) + '">Remove</button>' : '<span></span>') + '</div></div></article>').join('');
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
    grounds.push({id:'ground-' + Date.now(),name,sport:$('groundSport').value,location,price,description:$('groundDescription').value.trim()});
    saveGrounds(); renderGrounds(); $('groundForm').reset(); $('groundFormPanel').classList.add('hidden'); toast('Ground added to this browser demo.');
  });
  $('groundsGrid').addEventListener('click', event => {
    const button = event.target.closest('[data-delete]'); if (!button) return;
    grounds = grounds.filter(g => g.id !== button.dataset.delete); saveGrounds(); renderGrounds(); toast('Demo ground removed.');
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
})();