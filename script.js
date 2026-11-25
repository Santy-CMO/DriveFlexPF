'use strict';

/* Filtro del catálogo */
const botones = document.querySelectorAll('[data-filtro]');
const autos = document.querySelectorAll('.auto');

botones.forEach((boton) => {
  boton.addEventListener('click', () => {
    const filtro = boton.dataset.filtro;
    botones.forEach((b) => {
      const activo = b === boton;
      b.classList.toggle('activo', activo);
      b.setAttribute('aria-pressed', activo);
    });
    autos.forEach((auto) => {
      auto.hidden = filtro !== 'todos' && auto.dataset.categoria !== filtro;
    });
  });
});

/* Cotizador existente */
const form = document.getElementById('cotizador');

if (form) {
  const DEPOSITOS = { economico: 3000, sedan: 5000, suv: 7000 };
  const dinero = (n) => '$' + n.toLocaleString('es-MX');
  const $ = (id) => document.getElementById(id);
  const select = $('categoria');
  $('recogida').min = new Date().toISOString().split('T')[0];
  const previa = new URLSearchParams(location.search).get('categoria');
  if (previa && DEPOSITOS[previa]) select.value = previa;

  function calcular() {
    const precioDia = Number(select.selectedOptions[0].dataset.precio || 0);
    const dias = Math.max(1, Math.min(30, parseInt($('dias').value, 10) || 1));
    const cobertura = Number(form.elements.cobertura.value);
    let extras = 0;
    form.querySelectorAll('input[name="extra"]:checked').forEach((e) => {
      extras += e.dataset.tipo === 'dia' ? Number(e.value) * dias : Number(e.value);
    });
    const renta = precioDia * dias;
    const proteccion = cobertura * dias;
    $('r-renta').textContent = dinero(renta);
    $('r-cobertura').textContent = dinero(proteccion);
    $('r-extras').textContent = dinero(extras);
    $('r-total').textContent = dinero(renta + proteccion + extras);
    $('r-deposito').textContent = dinero(DEPOSITOS[select.value] || 0);
  }

  form.addEventListener('input', calcular);
  form.addEventListener('change', calcular);
  calcular();
  form.addEventListener('submit', (evento) => {
    evento.preventDefault();
    const mensaje = $('mensaje');
    if (!form.checkValidity()) {
      form.reportValidity();
      mensaje.textContent = 'Revisa los campos marcados y vuelve a enviar.';
      mensaje.className = 'error';
      return;
    }
    mensaje.textContent = 'Para comprobar disponibilidad y guardar una solicitud, continúa en Disponibilidad.';
    mensaje.className = 'exito';
    const link = document.createElement('a');
    link.href = 'reservas.html';
    link.textContent = ' Abrir disponibilidad y reservar';
    mensaje.append(link);
  });
}

/* Stock del catálogo: la página sigue funcionando aunque Supabase no esté configurado. */
(async function conectarInventarioPublico() {
  if (!document.querySelector('.catalogo')) return;
  try {
    const config = await import('./supabase-config.js');
    if (config.SUPABASE_URL.includes('TU-PROYECTO') || config.SUPABASE_ANON_KEY.includes('PEGA_AQUI')) return;
    const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
    const supabase = createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY);
    const catalogLink = document.querySelector('.menu');
    if (catalogLink && !document.querySelector('[data-reservas-link]')) {
      const li = document.createElement('li'); const a = document.createElement('a');
      a.href = 'reservas.html'; a.textContent = 'Disponibilidad'; a.dataset.reservasLink = 'true';
      li.append(a); catalogLink.append(li);
    }
    async function updateStock() {
      const { data, error } = await supabase.rpc('get_catalog_stock');
      if (error) return;
      (data || []).forEach((car) => {
        const card = Array.from(document.querySelectorAll('.auto')).find((node) => node.querySelector('h3')?.textContent.trim() === car.model);
        if (!card) return;
        let stock = card.querySelector('.stock-live');
        if (!stock) { stock = document.createElement('p'); stock.className = 'stock-live'; stock.setAttribute('aria-live', 'polite'); card.querySelector('.precio')?.after(stock); }
        stock.textContent = `Disponibles hoy: ${car.available_today} de ${car.total_units}`;
      });
    }
    await updateStock();
    supabase.channel('catalog-inventory')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'inventory_version' }, updateStock)
      .subscribe();
  } catch (error) {
    console.info('Inventario remoto no configurado; se conserva el catálogo estático.');
  }
})();
