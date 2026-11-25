import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './supabase-config.js';

const $ = (id) => document.getElementById(id);
const form = $('booking-form');
const modelSelect = $('model');
const dateInput = $('date-range');
const message = $('booking-message');
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

if (SUPABASE_URL.includes('TU-PROYECTO') || SUPABASE_ANON_KEY.includes('PEGA_AQUI')) {
  $('connection-status').textContent = 'Falta configurar Supabase: revisa supabase-config.js y la guía supabase/README.md.';
  $('connection-status').classList.add('error-text');
  form.addEventListener('submit', (event) => event.preventDefault());
} else {
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  let calendar;
  let inventory = [];
  let unavailable = [];
  let refreshTimer;

  const dateIsBlocked = (date) => unavailable.includes(
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  );

  async function loadUnavailable() {
    if (!modelSelect.value) {
      unavailable = [];
      if (calendar) calendar.set('disable', []);
      $('stock-for-dates').textContent = 'Selecciona un modelo para consultar las fechas.';
      return;
    }
    const from = today();
    const end = new Date();
    end.setDate(end.getDate() + 180);
    const to = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`;
    const { data, error } = await supabase.rpc('get_unavailable_dates', {
      p_model: modelSelect.value, p_from: from, p_to: to
    });
    if (error) {
      $('stock-for-dates').textContent = 'No se pudo consultar la disponibilidad. Intenta de nuevo.';
      return;
    }
    unavailable = (data || []).map((row) => row.unavailable_date);
    if (calendar) {
      calendar.set('disable', [dateIsBlocked]);
      calendar.redraw();
    }
    const item = inventory.find((car) => car.model === modelSelect.value);
    $('stock-for-dates').textContent = item
      ? `${item.total_units} unidad(es) en flota. ${unavailable.length ? 'Los días sin stock están bloqueados.' : 'Hay disponibilidad en las fechas consultadas.'}`
      : 'Consulta de disponibilidad actualizada.';
  }

  async function loadInventory() {
    const { data, error } = await supabase.rpc('get_catalog_stock');
    if (error) {
      $('connection-status').textContent = 'No se pudo cargar el inventario. Verifica la configuración de Supabase.';
      $('connection-status').classList.add('error-text');
      return;
    }
    inventory = data || [];
    $('connection-status').textContent = 'Inventario conectado · actualización en tiempo real activa.';
    const selected = modelSelect.value;
    modelSelect.replaceChildren(new Option('Selecciona un modelo', ''));
    inventory.forEach((car) => modelSelect.add(new Option(`${car.model} — ${car.available_today} disponible(s) hoy · $${Number(car.daily_price).toLocaleString('es-MX')}/día`, car.model)));
    if (inventory.some((car) => car.model === selected)) modelSelect.value = selected;
    $('inventory').replaceChildren(...inventory.map((car) => {
      const card = document.createElement('article');
      card.className = 'inventory-card';
      const title = document.createElement('h3'); title.textContent = car.model;
      const category = document.createElement('p'); category.textContent = `${car.category} · modelo ${car.year}`;
      const stock = document.createElement('p'); stock.className = 'stock-count';
      stock.textContent = `${car.available_today} disponible(s) hoy / ${car.total_units} en flota`;
      card.append(title, category, stock);
      return card;
    }));
    await loadUnavailable();
  }

  if (window.flatpickr) {
    calendar = window.flatpickr(dateInput, {
      mode: 'range', minDate: 'today', maxDate: new Date().fp_incr(180), dateFormat: 'Y-m-d',
      locale: window.flatpickr.l10ns.es, disable: [dateIsBlocked],
      onChange: (dates) => {
        if (dates.length === 2) {
          const days = Math.round((dates[1] - dates[0]) / 86400000);
          if (days < 1 || days > 30) {
            calendar.clear();
            message.textContent = 'La renta debe durar entre 1 y 30 días.';
            message.className = 'error-text';
          } else {
            message.textContent = '';
            message.className = '';
          }
        }
      }
    });
  } else {
    dateInput.placeholder = 'No se pudo cargar el calendario; recarga la página.';
    dateInput.disabled = true;
  }

  modelSelect.addEventListener('change', loadUnavailable);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    message.textContent = '';
    if (!form.reportValidity()) return;
    const dates = calendar?.selectedDates || [];
    if (dates.length !== 2) {
      message.textContent = 'Selecciona la fecha de entrega y devolución.';
      message.className = 'error-text';
      return;
    }
    const dateString = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    const pickup = dateString(dates[0]);
    const returned = dateString(dates[1]);
    if (unavailable.some((date) => date >= pickup && date < returned)) {
      message.textContent = 'Ese intervalo ya no tiene stock. El calendario se actualizará; selecciona otras fechas.';
      message.className = 'error-text';
      await loadUnavailable();
      return;
    }
    const button = $('submit-booking');
    button.disabled = true;
    button.textContent = 'Enviando…';
    const { data, error } = await supabase.rpc('create_reservation', {
      p_model: modelSelect.value,
      p_pickup_date: pickup,
      p_return_date: returned,
      p_customer_name: $('customer-name').value.trim(),
      p_customer_email: $('customer-email').value.trim(),
      p_customer_phone: $('customer-phone').value.trim()
    });
    button.disabled = false;
    button.textContent = 'Enviar solicitud';
    if (error) {
      message.textContent = error.message.includes('No hay unidades')
        ? 'Alguien reservó esta unidad justo antes. Actualizamos la disponibilidad; elige otras fechas.'
        : 'No se pudo guardar la solicitud. Revisa los datos e inténtalo de nuevo.';
      message.className = 'error-text';
      await loadInventory();
      return;
    }
    const booking = data?.[0];
    message.textContent = `Solicitud guardada como pendiente. Folio: ${booking?.reservation_id || 'confirmado'}. Total estimado: $${Number(booking?.total_price || 0).toLocaleString('es-MX')} MXN. DriveFlex confirmará por correo o teléfono.`;
    message.className = 'success-text';
    form.reset();
    calendar.clear();
    await loadInventory();
  });

  loadInventory();
  const channel = supabase.channel('public-inventory')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'inventory_version' }, () => {
      clearTimeout(refreshTimer);
      refreshTimer = setTimeout(loadInventory, 250);
    }).subscribe();
  window.addEventListener('pagehide', () => supabase.removeChannel(channel), { once: true });
}
