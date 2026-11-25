import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './supabase-config.js';

const $ = (id) => document.getElementById(id);
const authMessage = $('auth-message');
const ordersMessage = $('orders-message');
const statuses = ['pending', 'confirmed', 'rented', 'completed', 'cancelled'];
const labels = { pending: 'Pendiente', confirmed: 'Confirmado', rented: 'Rentado', completed: 'Completado', cancelled: 'Cancelado' };

if (SUPABASE_URL.includes('TU-PROYECTO') || SUPABASE_ANON_KEY.includes('PEGA_AQUI')) {
  authMessage.textContent = 'Configura Supabase en supabase-config.js y ejecuta supabase/schema.sql.';
  $('login-form').addEventListener('submit', (event) => event.preventDefault());
} else {
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const loginForm = $('login-form');
  let channel;

  function showSignedOut() {
    $('auth-panel').hidden = false;
    $('orders-panel').hidden = true;
    if (channel) supabase.removeChannel(channel);
  }

  async function loadOrders() {
    ordersMessage.textContent = 'Cargando pedidos…';
    const { data, error } = await supabase.from('reservations')
      .select('id, customer_name, customer_email, customer_phone, pickup_date, return_date, daily_price, total_price, status, created_at, vehicles(model, unit_code)')
      .order('created_at', { ascending: false }).limit(200);
    if (error) {
      ordersMessage.textContent = 'No se pudieron cargar los pedidos. Confirma que tu usuario esté agregado a admin_users.';
      return;
    }
    const body = $('orders-body');
    body.replaceChildren();
    if (!data?.length) {
      const row = body.insertRow(); const cell = row.insertCell(); cell.colSpan = 7; cell.textContent = 'Todavía no hay pedidos.';
    }
    (data || []).forEach((order) => {
      const row = body.insertRow();
      const values = [order.id.slice(0, 8).toUpperCase(), `${order.customer_name}\n${order.customer_email}\n${order.customer_phone}`, `${order.vehicles?.model || 'Auto'} (${order.vehicles?.unit_code || 'unidad'})`, `${order.pickup_date} → ${order.return_date}`, `$${Number(order.total_price).toLocaleString('es-MX')} MXN`];
      values.forEach((value) => { const cell = row.insertCell(); cell.textContent = value; });
      const stateCell = row.insertCell();
      const state = document.createElement('span'); state.className = 'order-status'; state.textContent = labels[order.status] || order.status; stateCell.append(state);
      const actionCell = row.insertCell();
      const select = document.createElement('select'); select.setAttribute('aria-label', `Estado del pedido ${order.id.slice(0, 8)}`);
      statuses.forEach((status) => select.add(new Option(labels[status], status, false, status === order.status)));
      select.addEventListener('change', async () => {
        select.disabled = true;
        const { error: updateError } = await supabase.rpc('admin_update_reservation_status', { p_reservation_id: order.id, p_status: select.value });
        select.disabled = false;
        if (updateError) {
          ordersMessage.textContent = 'No se pudo actualizar el estado. Verifica permisos o disponibilidad.';
          await loadOrders();
        } else {
          ordersMessage.textContent = `Pedido ${order.id.slice(0, 8)} actualizado: ${labels[select.value]}.`;
        }
      });
      actionCell.append(select);
    });
    if (data?.length) ordersMessage.textContent = `${data.length} pedido(s) mostrados.`;
  }

  async function checkSession() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { showSignedOut(); return; }
    $('auth-panel').hidden = true;
    $('orders-panel').hidden = false;
    $('admin-identity').textContent = `Sesión: ${session.user.email}`;
    await loadOrders();
    if (channel) supabase.removeChannel(channel);
    channel = supabase.channel('admin-orders')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'reservations' }, loadOrders)
      .subscribe();
  }

  loginForm.addEventListener('submit', async (event) => {
    event.preventDefault(); authMessage.textContent = 'Validando…';
    const { error } = await supabase.auth.signInWithPassword({ email: $('email').value.trim(), password: $('password').value });
    if (error) { authMessage.textContent = 'No se pudo iniciar sesión. Revisa los datos y que el usuario esté autorizado.'; return; }
    authMessage.textContent = ''; await checkSession();
  });
  $('refresh-orders').addEventListener('click', loadOrders);
  $('logout').addEventListener('click', async () => { await supabase.auth.signOut(); showSignedOut(); });
  supabase.auth.onAuthStateChange((_event, session) => { if (!session) showSignedOut(); });
  checkSession();
}
