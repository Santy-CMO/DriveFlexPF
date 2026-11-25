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

/* Cotizador */
const form = document.getElementById('cotizador');

if (form) {
  const DEPOSITOS = { economico: 3000, sedan: 5000, suv: 7000 };
  const dinero = (n) => '$' + n.toLocaleString('es-MX');
  const $ = (id) => document.getElementById(id);
  const select = $('categoria');

  // Fecha mínima: hoy
  $('recogida').min = new Date().toISOString().split('T')[0];

  // Categoría preseleccionada desde el catálogo (?categoria=suv)
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
      form.reportValidity(); // validación nativa del navegador
      mensaje.textContent = 'Revisa los campos marcados y vuelve a enviar.';
      mensaje.className = 'error';
      return;
    }
    mensaje.textContent = 'Solicitud enviada. Te confirmaremos la disponibilidad por correo o teléfono.';
    mensaje.className = 'exito';
    form.reset();
    calcular();
  });
}
