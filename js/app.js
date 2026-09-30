const API_URL = 'https://script.google.com/macros/s/AKfycby8s7CwxJlElbSbhgrvkPmtSejCvSavQ4QW3UoJZdpPO_NtFrgb6h1fxE-hfSrNtIbc/exec';

// ============================================================
// ACCESOS POR ROL (cambiá los códigos acá cuando lo necesites)
// admin  = ve todo y puede editar
// visita = solo ve las reservas y agrega nuevas
// ============================================================
const ACCESOS = {
  admin: 'Dtra-2373',
  visita: 'Finanza2026'
};

const MOTIVOS_RECHAZO = [
  "Horario ocupado",
  "Solicitar nueva fecha",
  "Solicitar nuevo horario",
  "Pendiente de evaluación",
  "Reprogramada",
  "Cancelada"
];

let TODAS_LAS_RESERVAS = [];
let FILTRO_ACTUAL = null;
let FECHA_BUSCAR = null;
let TEXTO_BUSCAR = '';
let pagActual = 1;
let GANTT_ABIERTO = true;

const NOMBRES_FILTRO = {
  pendientes: 'Pendientes de aprobar',
  hoy: 'Reservas de hoy',
  semana: 'Próximos 7 días',
  canceladas: 'Canceladas / Rechazadas (mes)'
};

// ============================================================
// ROLES / SESIÓN
// ============================================================
function obtenerRol() {
  try {
    var r = localStorage.getItem('reservaSalaRol');
    return (r === 'admin' || r === 'visita') ? r : null;
  } catch (e) {
    return null;
  }
}

function esAdmin() {
  return obtenerRol() === 'admin';
}

function guardarRol(rol) {
  try { localStorage.setItem('reservaSalaRol', rol); } catch (e) {}
}

function cerrarSesion() {
  try { localStorage.removeItem('reservaSalaRol'); } catch (e) {}
  aplicarPermisos();
}

function intentarAcceso() {
  var input = document.getElementById('login-pin');
  var error = document.getElementById('login-error');
  var cod = (input.value || '').trim();
  var rol = null;
  if (cod && cod === ACCESOS.admin) rol = 'admin';
  else if (cod && cod === ACCESOS.visita) rol = 'visita';

  if (!rol) {
    error.style.display = '';
    input.value = '';
    input.focus();
    return;
  }
  error.style.display = 'none';
  input.value = '';
  guardarRol(rol);
  aplicarPermisos();
  mostrarToast('success', rol === 'admin' ? 'Sesión de Administrador iniciada' : 'Sesión de Consulta iniciada');
}

function aplicarPermisos() {
  var rol = obtenerRol();
  var admin = rol === 'admin';

  var overlay = document.getElementById('login-overlay');
  if (overlay) overlay.style.display = rol ? 'none' : 'flex';

  var btnCalendario = document.getElementById('btn-calendario');
  if (btnCalendario) btnCalendario.style.display = admin ? '' : 'none';

  var btnComisiones = document.getElementById('btn-comisiones');
  if (btnComisiones) btnComisiones.style.display = admin ? '' : 'none';

  var chip = document.getElementById('sesion-rol');
  if (chip) {
    chip.style.display = rol ? '' : 'none';
    chip.textContent = admin ? 'Administrador' : 'Consulta';
    chip.className = 'badge sesion-rol ' + (admin ? 'bg-dark' : 'bg-secondary');
  }

  var btnSalir = document.getElementById('btn-salir');
  if (btnSalir) btnSalir.style.display = rol ? '' : 'none';

  if (TODAS_LAS_RESERVAS.length) pintarLista();
}

function cargarDatosCache() {
  try {
    var raw = localStorage.getItem('reservaSalaDatos');
    if (raw) return JSON.parse(raw);
  } catch(e) {}
  return null;
}

function guardarCacheDatos(data) {
  try { localStorage.setItem('reservaSalaDatos', JSON.stringify(data)); } catch(e) {}
}

async function cargarDatos() {
  try {
    var res = await fetch(API_URL + '?action=obtenerDatosPanel');
    var data = await res.json();
    if (!data.error) guardarCacheDatos(data);
    return data;
  } catch (err) {
    console.error('Error cargando datos:', err);
    return null;
  }
}

async function enviarAccion(action, params) {
  try {
    var res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ action: action, ...params })
    });
    return await res.json();
  } catch (err) {
    console.error('Error:', err);
    return { exito: false, mensaje: 'Error de conexion' };
  }
}

function renderPanel(data) {
  if (!data) return;
  document.getElementById('cargando').style.display = 'none';
  document.getElementById('kpis').style.display = '';
  document.getElementById('kpi-pendientes').textContent = data.kpis.pendientes;
  document.getElementById('kpi-hoy').textContent = data.kpis.hoy;
  document.getElementById('kpi-semana').textContent = data.kpis.semana;
  document.getElementById('kpi-canceladas').textContent = data.kpis.canceladasMes;
  TODAS_LAS_RESERVAS = data.reservas;
  pagActual = 1;
  pintarLista();
}

function cargarPanel() {
  var cache = cargarDatosCache();
  if (cache) renderPanel(cache);
  cargarDatos().then(function(data) { if (data) renderPanel(data); });
}

async function actualizarPanel() {
  var btn = document.getElementById('btn-actualizar');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Actualizando...';
  await cargarDatos().then(function(data) { if (data) renderPanel(data); });
  btn.disabled = false;
  btn.innerHTML = '↻ Actualizar';
}

function parsearFecha(ddmmyyyy) {
  var p = ddmmyyyy.split('/');
  return new Date(p[2], p[1] - 1, p[0]);
}

function categoriaFecha(f, h, m) {
  if (f.getTime() === h.getTime()) return 'hoy';
  if (f.getTime() === m.getTime()) return 'manana';
  if (f.getTime() < h.getTime()) return 'pasada';
  return '';
}

function cumpleFiltro(r, hoy, manana, semanaLimite, mesInicio) {
  if (!FILTRO_ACTUAL) return true;
  var f = parsearFecha(r.fecha), e = (r.estado || '').trim().toLowerCase();
  if (!e) e = 'pendiente';  // sin estado = recién cargada, se trata como pendiente
  if (FILTRO_ACTUAL === 'pendientes') return e.indexOf('pendiente') !== -1;
  if (FILTRO_ACTUAL === 'hoy') return f.getTime() === hoy.getTime() && e.indexOf('aprobada') !== -1;
  if (FILTRO_ACTUAL === 'semana') return f >= hoy && f <= semanaLimite && e.indexOf('aprobada') !== -1;
  if (FILTRO_ACTUAL === 'canceladas') return (e.indexOf('cancelada') !== -1 || e.indexOf('rechazada') !== -1) && f >= mesInicio;
  return true;
}

function filtrarPor(filtro) {
  FILTRO_ACTUAL = (FILTRO_ACTUAL === filtro) ? null : filtro;
  document.querySelectorAll('.kpi-card').forEach(function(card) {
    card.classList.toggle('activo', card.getAttribute('data-filtro') === FILTRO_ACTUAL);
  });
  var pf = document.getElementById('filtro-activo');
  if (FILTRO_ACTUAL) {
    pf.style.display = '';
    document.getElementById('filtro-nombre').textContent = NOMBRES_FILTRO[FILTRO_ACTUAL];
  } else {
    pf.style.display = 'none';
  }
  limpiarFecha();
  TEXTO_BUSCAR = '';
  document.getElementById('buscador').value = '';
  pagActual = 1;
  pintarLista();
}

function buscarFecha(valor) {
  if (valor) {
    var p = valor.split('-');
    FECHA_BUSCAR = new Date(parseInt(p[0]), parseInt(p[1]) - 1, parseInt(p[2]));
    document.getElementById('btn-clear-fecha').style.display = '';
  } else {
    FECHA_BUSCAR = null;
    document.getElementById('btn-clear-fecha').style.display = 'none';
  }
  FILTRO_ACTUAL = null;
  document.querySelectorAll('.kpi-card').forEach(function(c) { c.classList.remove('activo'); });
  document.getElementById('filtro-activo').style.display = 'none';
  pagActual = 1;
  pintarLista();
}

function limpiarFecha() {
  FECHA_BUSCAR = null;
  document.getElementById('fecha-buscar').value = '';
  document.getElementById('btn-clear-fecha').style.display = 'none';
  document.getElementById('fecha-contador').style.display = 'none';
  pagActual = 1;
  pintarLista();
}

function limpiarFecha() {
  FECHA_BUSCAR = null;
  document.getElementById('fecha-buscar').value = '';
  document.getElementById('btn-clear-fecha').style.display = 'none';
  pagActual = 1;
  pintarLista();
}

function getVisibles() {
  var hoy = new Date(); hoy.setHours(0,0,0,0);
  var manana = new Date(hoy); manana.setDate(hoy.getDate() + 1);
  var sl = new Date(hoy); sl.setDate(hoy.getDate() + 7);
  var mi = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
  var visibles = TODAS_LAS_RESERVAS.filter(function(r) {
    if (!cumpleFiltro(r, hoy, manana, sl, mi)) return false;
    if (FECHA_BUSCAR) {
      var fr = parsearFecha(r.fecha);
      if (fr.getTime() !== FECHA_BUSCAR.getTime()) return false;
    }
    if (!TEXTO_BUSCAR) return true;
    var busq = TEXTO_BUSCAR.toLowerCase();
    return (r.motivo + ' ' + r.autoridad + ' ' + r.responsable + ' ' + r.estado + ' ' + (r.numeroSolicitud || '') + ' ' + (r.dependencias || '') + ' ' + (r.email || '')).toLowerCase().indexOf(busq) !== -1;
  });
  visibles.sort(function(a, b) {
    var fa = parsearFecha(a.fecha);
    var fb = parsearFecha(b.fecha);
    if (FILTRO_ACTUAL === 'semana') {
      if (fa.getTime() !== fb.getTime()) return fa - fb;
      return a.fila - b.fila;
    }
    if (fa.getTime() !== fb.getTime()) return fb - fa;
    return b.fila - a.fila;
  });
  return visibles;
}

function pintarLista() {
  var visibles = getVisibles();
  var total = visibles.length;
  var contador = document.getElementById('fecha-contador');
  if (FECHA_BUSCAR) {
    contador.style.display = '';
    contador.textContent = total;
  } else {
    contador.style.display = 'none';
  }
  var porPagina = parseInt(document.getElementById('pag-tamanio').value);
  var totalPaginas = Math.max(1, Math.ceil(total / porPagina));
  if (pagActual > totalPaginas) pagActual = totalPaginas;

  var desde = (pagActual - 1) * porPagina;
  var hasta = Math.min(desde + porPagina, total);
  var items = visibles.slice(desde, hasta);

  document.getElementById('vacio').style.display = total === 0 ? '' : 'none';

  var controles = document.getElementById('controles-paginacion');
  controles.style.display = total > 0 ? '' : 'none';
  document.getElementById('pag-desde').textContent = total > 0 ? desde + 1 : 0;
  document.getElementById('pag-hasta').textContent = hasta;
  document.getElementById('pag-total').textContent = total;

  var paginador = document.getElementById('paginador');
  paginador.style.display = totalPaginas > 1 ? '' : 'none';
  var paginas = document.getElementById('pag-paginas');
  paginas.innerHTML = '';
  for (var i = 1; i <= totalPaginas; i++) {
    var li = document.createElement('li');
    li.className = 'page-item' + (i === pagActual ? ' active' : '');
    li.innerHTML = '<button class="page-link" onclick="cambiarPagina(' + i + ')">' + i + '</button>';
    paginas.appendChild(li);
  }

  var contenedor = document.getElementById('lista-reservas');
  contenedor.innerHTML = '';

  items.forEach(function(r) {
    var fechaReserva = parsearFecha(r.fecha);
    var hoy = new Date(); hoy.setHours(0,0,0,0);
    var manana = new Date(hoy); manana.setDate(hoy.getDate() + 1);
    var catFecha = categoriaFecha(fechaReserva, hoy, manana);
    var el = (r.estado || '').trim().toLowerCase();
    if (!el) el = 'pendiente';  // sin estado = recién cargada, se trata como pendiente
    var er = el.indexOf('rechazada') !== -1;
    var cb = el.indexOf('pendiente') !== -1 ? 'pendiente' : el.indexOf('aprobada') !== -1 ? 'aprobada' : el.indexOf('cancelada') !== -1 ? 'cancelada' : er ? 'rechazada' : '';
    var ef = catFecha === 'hoy' ? '<span class="badge bg-warning text-dark ms-2">HOY</span>' : catFecha === 'pasada' ? '<span class="fecha-tag pasada">Ya pasó</span>' : catFecha === 'manana' ? '<span class="fecha-tag manana">Mañana</span>' : '';
    var ep = el.indexOf('pendiente') !== -1;
    var ec = el.indexOf('cancelada') !== -1;
    var er = el.indexOf('rechazada') !== -1;
    var b = '';
    if (esAdmin()) {
      if (ep) {
        b = '<button class="btn btn-sm btn-success" onclick="aprobar(' + r.fila + ')">Aprobar</button>' +
            '<button class="btn btn-sm btn-warning" onclick="mostrarRechazo(' + r.fila + ')">Rechazar</button>' +
            '<button class="btn btn-sm btn-info text-white" onclick="abrirEdicion(' + r.fila + ')">Editar</button>';
      } else if (el.indexOf('aprobada') !== -1) {
        b = '<button class="btn btn-sm btn-outline-danger" onclick="cancelar(' + r.fila + ')">Cancelar</button>' +
            '<button class="btn btn-sm btn-warning" onclick="mostrarRechazo(' + r.fila + ')">Rechazar</button>' +
            '<button class="btn btn-sm btn-info text-white" onclick="abrirEdicion(' + r.fila + ')">Editar</button>';
      } else if (ec || er) {
        b = '<button class="btn btn-sm btn-outline-success" onclick="reactivar(' + r.fila + ')">Reactivar</button>';
      }
      b += '<button class="btn btn-sm btn-outline-secondary" onclick="eliminar(' + r.fila + ')">Eliminar</button>';
    }
    var ob = er ? ' onclick="toggleMotivo(' + r.fila + ')"' : '';
    var mt = r.observaciones ? r.observaciones : 'Sin motivo registrado';
    var mh = er ? '<div class="motivo-rechazo" id="motivo-rechazo-' + r.fila + '">Motivo del rechazo: ' + mt + '</div>' : '';
    var div = document.createElement('div');
    div.className = 'card reserva shadow-sm mb-3 border-0' + (catFecha ? ' ' + catFecha : '') + (catFecha === 'hoy' ? ' hoy-reserva' : '');
    div.id = 'reserva-' + r.fila;
    div.innerHTML =
      '<div class="card-body d-flex justify-content-between align-items-start flex-wrap gap-2">' +
        '<div class="flex-grow-1">' +
          '<div class="fw-bold mb-1">' + r.motivo + ef + ' <span class="badge-estado ' + cb + '"' + ob + '>' + (r.estado || 'Pendiente') + '</span></div>' +
          '<p class="mb-1 text-secondary small">' + r.fecha + ' - ' + r.horaInicio + ' a ' + r.horaFin + '</p>' +
          '<p class="mb-1 text-secondary small"><strong>Autoridad:</strong> ' + r.autoridad + ' | <strong>Responsable:</strong> ' + r.responsable + '</p>' +
          (r.asistentes ? '<p class="mb-1 text-secondary small"><strong>Asistentes:</strong> ' + r.asistentes + '</p>' : '') +
          (r.dependencias ? '<p class="mb-1 text-secondary small"><strong>Org. Participantes:</strong> ' + r.dependencias + '</p>' : '') +
          (r.requerimientos ? '<p class="mb-1 text-secondary small"><strong>Requerimientos:</strong> ' + r.requerimientos + '</p>' : '') +
          (r.telefono ? '<p class="mb-1 text-secondary small"><strong>Teléfono:</strong> ' + r.telefono + '</p>' : '') +
          (r.email ? '<p class="mb-1 text-secondary small"><strong>Email:</strong> ' + r.email + '</p>' : '') +
          (r.numeroSolicitud ? '<p class="mb-1 text-secondary small"><strong>N° Solicitud:</strong> ' + r.numeroSolicitud + '</p>' : '') +
          mh +
          '<div class="rechazo-panel mt-2" id="rechazo-' + r.fila + '" style="display:none;"></div>' +
        '</div>' +
        '<div class="d-flex flex-wrap gap-1">' + b + '</div>' +
      '</div>';
    contenedor.appendChild(div);
  });
  renderGanttPanel();
}

function irAReserva(fila) {
  var visibles = getVisibles();
  var idx = -1;
  for (var i = 0; i < visibles.length; i++) {
    if (visibles[i].fila === fila) { idx = i; break; }
  }
  if (idx === -1) {
    mostrarToast('warning', 'La reserva no está en el listado actual (revisá los filtros)');
    return;
  }
  var porPagina = parseInt(document.getElementById('pag-tamanio').value);
  pagActual = Math.floor(idx / porPagina) + 1;
  pintarLista();
  var el = document.getElementById('reserva-' + fila);
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('resaltada');
    setTimeout(function() { el.classList.remove('resaltada'); }, 2500);
  }
}

function escTxt(t) {
  return (t == null ? '' : String(t)).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function horasDecPanel(texto) {
  if (!texto) return null;
  var t = String(texto).toLowerCase();
  var m = t.match(/(\d{1,2}):(\d{2})/);
  if (!m) return null;
  var h = parseInt(m[1], 10);
  var mm = parseInt(m[2], 10);
  var esAm = /a\.?\s?m/.test(t);
  var esPm = /p\.?\s?m/.test(t);
  if (esAm && h === 12) h = 0;
  else if (esPm && h < 12) h += 12;
  return h + mm / 60;
}

function horaCorta(texto) {
  if (!texto) return '';
  var t = String(texto).toLowerCase();
  var m = t.match(/(\d{1,2}):(\d{2})/);
  if (!m) return String(texto);
  var s = m[1].padStart(2, '0') + ':' + m[2];
  if (/a\.?\s?m/.test(t)) s += ' a.m.';
  else if (/p\.?\s?m/.test(t)) s += ' p.m.';
  return s;
}

function colorEstado(estado) {
  var e = (estado || '').trim().toLowerCase();
  if (!e) e = 'pendiente';
  if (e.indexOf('pendiente') !== -1) return '#f5a623';
  if (e.indexOf('aprobada') !== -1) return '#1d9e75';
  if (e.indexOf('rechazada') !== -1) return '#d85a30';
  if (e.indexOf('cancelada') !== -1) return '#94a3b8';
  return '#6b7280';
}

function reservasDelDia(diaRef) {
  var hoy = new Date(); hoy.setHours(0,0,0,0);
  var manana = new Date(hoy); manana.setDate(hoy.getDate() + 1);
  var sl = new Date(hoy); sl.setDate(hoy.getDate() + 7);
  var mi = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
  var busq = TEXTO_BUSCAR.toLowerCase();
  return TODAS_LAS_RESERVAS.filter(function(r) {
    if (parsearFecha(r.fecha).getTime() !== diaRef.getTime()) return false;
    if (!cumpleFiltro(r, hoy, manana, sl, mi)) return false;
    if (!busq) return true;
    return (r.motivo + ' ' + r.autoridad + ' ' + r.responsable + ' ' + (r.estado || '') + ' ' + (r.numeroSolicitud || '') + ' ' + (r.dependencias || '') + ' ' + (r.email || '')).toLowerCase().indexOf(busq) !== -1;
  });
}

function renderGanttPanel() {
  var cont = document.getElementById('gantt-panel');
  if (!cont) return;
  if (!GANTT_ABIERTO) { cont.style.display = 'none'; return; }

  // Día a mostrar: fecha elegida > primer día con reservas del filtro activo > hoy
  var diaRef = null;
  if (FECHA_BUSCAR) {
    diaRef = FECHA_BUSCAR;
  } else if (FILTRO_ACTUAL) {
    var vis = getVisibles();
    for (var k = 0; k < vis.length; k++) {
      var fv = parsearFecha(vis[k].fecha);
      if (!diaRef || fv.getTime() < diaRef.getTime()) diaRef = fv;
    }
  }
  if (!diaRef) diaRef = new Date();
  diaRef = new Date(diaRef.getFullYear(), diaRef.getMonth(), diaRef.getDate());
  var hoyD = new Date(); hoyD.setHours(0,0,0,0);
  var esHoy = diaRef.getTime() === hoyD.getTime();
  var titulo = '<div class="gantt-titulo">📅 Reservas del día — ' +
    diaRef.getDate() + '/' + (diaRef.getMonth() + 1) + '/' + diaRef.getFullYear() +
    (esHoy ? ' (hoy)' : '') + '</div>';

  var reservasDia = reservasDelDia(diaRef);

  var conHora = [];
  var i;
  for (i = 0; i < reservasDia.length; i++) {
    var r = reservasDia[i];
    var hi = horasDecPanel(r.horaInicio);
    var hf = horasDecPanel(r.horaFin);
    if (hi === null) continue;
    if (hf === null || hf <= hi) hf = hi + 1;
    conHora.push({ ref: r, _hi: hi, _hf: hf });
  }

  if (conHora.length === 0) {
    cont.innerHTML = titulo + '<div class="gantt-vacio">No hay reservas con horario para este día.</div>';
    cont.style.display = '';
    return;
  }

  var minHora = 24, maxHora = 0;
  for (i = 0; i < conHora.length; i++) {
    if (conHora[i]._hi < minHora) minHora = conHora[i]._hi;
    if (conHora[i]._hf > maxHora) maxHora = conHora[i]._hf;
  }
  if (minHora >= maxHora) { minHora = 8; maxHora = 22; }
  var rangoIni = Math.max(0, Math.floor(minHora / 2) * 2);
  var rangoFin = Math.min(24, Math.ceil(maxHora / 2) * 2);
  if (rangoFin - rangoIni < 2) rangoFin = Math.min(24, rangoIni + 2);
  var totalHoras = rangoFin - rangoIni;

  conHora.sort(function(a, b) { return a._hi - b._hi; });
  var lanes = [];
  var conflictos = {};
  var l;
  for (i = 0; i < conHora.length; i++) {
    var it = conHora[i];
    var lane = -1;
    for (l = 0; l < lanes.length; l++) {
      if (lanes[l] <= it._hi + 0.01) { lane = l; break; }
    }
    if (lane === -1) { lane = lanes.length; lanes.push(0); }
    lanes[lane] = it._hf;
    it._lane = lane;
  }
  var j;
  for (i = 0; i < conHora.length; i++) {
    for (j = i + 1; j < conHora.length; j++) {
      var a = conHora[i], b = conHora[j];
      if (a._hi < b._hf - 0.01 && b._hi < a._hf - 0.01) {
        conflictos[a.ref.fila] = true;
        conflictos[b.ref.fila] = true;
      }
    }
  }

  var pasos = totalHoras > 12 ? 2 : 1;
  var html = titulo;
  var h, pct;
  html += '<div class="gantt-eje"><div class="gantt-eje-espaciador"></div><div class="gantt-eje-marcas">';
  for (h = rangoIni; h <= rangoFin; h += pasos) {
    pct = ((h - rangoIni) / totalHoras) * 100;
    html += '<span class="gantt-marca" style="left:' + pct + '%;">' + (h < 10 ? '0' : '') + h + ':00</span>';
  }
  html += '</div></div>';

  var l2;
  for (l2 = 0; l2 < lanes.length; l2++) {
    html += '<div class="gantt-fila"><div class="gantt-fila-etiqueta"></div><div class="gantt-pista">';
    for (h = rangoIni; h <= rangoFin; h += pasos) {
      pct = ((h - rangoIni) / totalHoras) * 100;
      html += '<div class="gantt-linea" style="left:' + pct + '%;"></div>';
    }
    for (i = 0; i < conHora.length; i++) {
      var item = conHora[i];
      if (item._lane !== l2) continue;
      var rr = item.ref;
      var color = colorEstado(rr.estado);
      var izq = ((item._hi - rangoIni) / totalHoras) * 100;
      var ancho = ((item._hf - item._hi) / totalHoras) * 100;
      var horaTxt = horaCorta(rr.horaInicio) + ' a ' + horaCorta(rr.horaFin);
      html += '<div class="gantt-barra' + (conflictos[rr.fila] ? ' conflicto' : '') + '" ' +
        'style="left:' + izq + '%;width:' + ancho + '%;background:' + color + ';" ' +
        'onclick="irAReserva(' + rr.fila + ')" ' +
        'title="' + escTxt(rr.motivo) + ' — ' + horaTxt + '">' +
        '<span class="gantt-barra-texto">' + escTxt(rr.motivo || 'Sin motivo') + '</span>' +
        '<span class="gantt-barra-hora">' + horaTxt + '</span></div>';
    }
    html += '</div></div>';
  }

  html += '<div class="gantt-leyenda">' +
    '<span><i style="background:#f5a623"></i> Pendiente</span>' +
    '<span><i style="background:#1d9e75"></i> Aprobada</span>' +
    '<span><i style="background:#d85a30"></i> Rechazada</span>' +
    '<span><i style="background:#94a3b8"></i> Cancelada</span>' +
    '<span><i class="conflicto"></i> Horario en conflicto</span>' +
    '</div>';

  cont.innerHTML = html;
  cont.style.display = '';
}

function cambiarPagina(pag) {
  var totalPaginas = Math.ceil(getVisibles().length / parseInt(document.getElementById('pag-tamanio').value));
  if (pag < 1 || pag > totalPaginas) return;
  pagActual = pag;
  pintarLista();
  window.scrollTo({ top: document.getElementById('lista-reservas').offsetTop - 20, behavior: 'smooth' });
}

var busquedaTimer = null;
function buscar(texto) {
  clearTimeout(busquedaTimer);
  busquedaTimer = setTimeout(function() {
    TEXTO_BUSCAR = texto.trim();
    pagActual = 1;
    pintarLista();
  }, 300);
}

function toggleMotivo(fila) {
  document.getElementById('motivo-rechazo-' + fila).classList.toggle('visible');
}

function exigirAdmin(accion) {
  if (esAdmin()) return true;
  mostrarToast('warning', 'Tu rol de Consulta no permite ' + (accion || 'modificar reservas'));
  return false;
}

async function aprobar(fila) {
  if (!exigirAdmin('aprobar')) return;
  if (!confirm('¿Aprobar esta reserva y crearla en el Calendar?')) return;
  var res = await enviarAccion('aprobarReserva', { fila: fila });
  var tipo = res.mensaje.indexOf('rechazada') !== -1 ? 'warning' : (res.exito ? 'success' : 'danger');
  mostrarToast(tipo, res.mensaje);
  cargarPanel();
}

function mostrarRechazo(fila) {
  if (!exigirAdmin('rechazar')) return;
  var panel = document.getElementById('rechazo-' + fila);
  if (panel.style.display === 'block') { panel.style.display = 'none'; return; }
  var o = '<select class="form-select form-select-sm d-inline-block" style="width:auto;" id="motivo-select-' + fila + '">';
  MOTIVOS_RECHAZO.forEach(function(m) { o += '<option value="' + m + '">' + m + '</option>'; });
  o += '</select> <button class="btn btn-sm btn-dark ms-1" onclick="confirmarRechazo(' + fila + ')">Confirmar</button>';
  panel.innerHTML = o;
  panel.style.display = 'block';
}

async function confirmarRechazo(fila) {
  if (!exigirAdmin('rechazar')) return;
  var motivo = document.getElementById('motivo-select-' + fila).value;
  var res = await enviarAccion('rechazarReserva', { fila: fila, motivo: motivo });
  mostrarToast(res.exito ? 'success' : 'danger', res.mensaje);
  cargarPanel();
}

async function cancelar(fila) {
  if (!exigirAdmin('cancelar')) return;
  if (!confirm('¿Cancelar esta reserva? Se borrará el evento del Calendar.')) return;
  var res = await enviarAccion('cancelarReserva', { fila: fila });
  mostrarToast(res.exito ? 'success' : 'danger', res.mensaje);
  cargarPanel();
}

async function eliminar(fila) {
  if (!exigirAdmin('eliminar')) return;
  if (!confirm('¿ELIMINAR esta fila por completo? No se puede deshacer.')) return;
  var res = await enviarAccion('eliminarDefinitivo', { fila: fila });
  mostrarToast(res.exito ? 'success' : 'danger', res.mensaje);
  cargarPanel();
}

async function reactivar(fila) {
  if (!exigirAdmin('reactivar')) return;
  if (!confirm('¿Reactivar esta reserva? Volverá a estado Pendiente.')) return;
  var res = await enviarAccion('reactivarReserva', { fila: fila });
  mostrarToast(res.exito ? 'success' : 'danger', res.mensaje);
  cargarPanel();
}

function mostrarToast(tipo, mensaje) {
  var container = document.getElementById('toast-container');
  var id = 'toast-' + Date.now();
  var icono = tipo === 'success' ? '✓' : '✗';
  var html = '<div id="' + id + '" class="toast align-items-center text-bg-' + tipo + ' border-0 show" role="alert">' +
    '<div class="d-flex">' +
      '<div class="toast-body"><strong>' + icono + '</strong> ' + mensaje + '</div>' +
      '<button type="button" class="btn-close btn-close-white me-2 m-auto" onclick="document.getElementById(\'' + id + '\').remove()"></button>' +
    '</div></div>';
  container.insertAdjacentHTML('beforeend', html);
  setTimeout(function() { var el = document.getElementById(id); if (el) el.remove(); }, 3500);
}

function abrirEdicion(fila) {
  if (!exigirAdmin('editar')) return;
  var reserva = TODAS_LAS_RESERVAS.find(function(r) { return r.fila === fila; });
  if (!reserva) return;

  document.getElementById('edit-fila').value = fila;
  document.getElementById('edit-motivo').value = reserva.motivo;

  // Convertir fecha de "dd/MM/yyyy" a "yyyy-MM-dd" para input date
  var partes = reserva.fecha.split('/');
  document.getElementById('edit-fecha').value = partes[2] + '-' + partes[1] + '-' + partes[0];

  // Extraer horas de los strings (pueden venir como "HH:mm" o con AM/PM)
  var hi = extraerHoras(reserva.horaInicio);
  var hf = extraerHoras(reserva.horaFin);
  document.getElementById('edit-horaInicio').value = hi;
  document.getElementById('edit-horaFin').value = hf;

  document.getElementById('edit-autoridad').value = reserva.autoridad || '';
  document.getElementById('edit-responsable').value = reserva.responsable || '';
  document.getElementById('edit-asistentes').value = reserva.asistentes || '';
  document.getElementById('edit-dependencias').value = reserva.dependencias || '';
  document.getElementById('edit-requerimientos').value = reserva.requerimientos || '';
  document.getElementById('edit-telefono').value = reserva.telefono || '';
  document.getElementById('edit-email').value = reserva.email || '';

  var modal = new bootstrap.Modal(document.getElementById('modalEditar'));
  modal.show();
}

function extraerHoras(texto) {
  if (!texto) return '09:00';
  texto = texto.toString().trim();
  // Si ya tiene formato HH:mm
  var match = texto.match(/(\d{1,2}):(\d{2})/);
  if (match) {
    var h = match[1].padStart(2, '0');
    var m = match[2].padStart(2, '0');
    // Detectar PM
    if (texto.toLowerCase().includes('pm') && parseInt(h) < 12) {
      h = String(parseInt(h) + 12).padStart(2, '0');
    }
    return h + ':' + m;
  }
  return '09:00';
}

async function guardarEdicion() {
  if (!exigirAdmin('editar')) return;
  var fila = parseInt(document.getElementById('edit-fila').value);
  var motivo = document.getElementById('edit-motivo').value.trim();
  var fecha = document.getElementById('edit-fecha').value;
  var horaInicio = document.getElementById('edit-horaInicio').value;
  var horaFin = document.getElementById('edit-horaFin').value;
  var autoridad = document.getElementById('edit-autoridad').value.trim();
  var responsable = document.getElementById('edit-responsable').value.trim();
  var asistentes = document.getElementById('edit-asistentes').value.trim();
  var dependencias = document.getElementById('edit-dependencias').value.trim();
  var requerimientos = document.getElementById('edit-requerimientos').value.trim();
  var telefono = document.getElementById('edit-telefono').value.trim();
  var email = document.getElementById('edit-email').value.trim();

  if (!motivo || !fecha || !horaInicio || !horaFin) {
    mostrarToast('warning', 'Completá todos los campos');
    return;
  }

  var modal = bootstrap.Modal.getInstance(document.getElementById('modalEditar'));
  modal.hide();

  var res = await enviarAccion('editarReserva', {
    fila: fila,
    datos: {
      motivo: motivo,
      fecha: fecha,
      horaInicio: horaInicio,
      horaFin: horaFin,
      autoridad: autoridad,
      responsable: responsable,
      asistentes: asistentes,
      dependencias: dependencias,
      requerimientos: requerimientos,
      telefono: telefono,
      email: email
    }
  });
  mostrarToast(res.exito ? 'success' : 'danger', res.mensaje);
  cargarPanel();
}

aplicarPermisos();
cargarPanel();
setInterval(cargarPanel, 60000);

document.addEventListener('DOMContentLoaded', function() {
  var input = document.getElementById('login-pin');
  if (!input) return;
  input.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') intentarAcceso();
  });
  input.focus();
});
