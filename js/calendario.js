var API_URL = 'https://script.google.com/macros/s/AKfycbxvl9L-VvYna_bF44QGplTOn9opVFPq-jHK-6LCz-hPoOYVZPmJbPOPRRw0fzZkAuA8/exec';

var todosLosEventos = [];
var eventosFiltrados = [];
var FILTRO_PERIODO = 'hoy';
var FILTRO_TIPO = null;
var FECHA_BUSCAR_CAL = null;
var TEXTO_BUSQUEDA = '';
var pagActual = 1;
var eventoSeleccionadoId = null;

document.addEventListener('DOMContentLoaded', function() {
  cargarTodosLosEventos();
});

function cargarTodosLosEventos() {
  var cacheKey = 'calEventos_' + new Date().getFullYear();

  var hoy = new Date();
  var desde = new Date(hoy.getFullYear(), 0, 1);
  var hasta = new Date(hoy.getFullYear(), 11, 31, 23, 59, 59);

  var url = API_URL + '?action=obtenerEventosCalendario&desde=' + encodeURIComponent(desde.toISOString()) + '&hasta=' + encodeURIComponent(hasta.toISOString());

  document.getElementById('cargando').style.display = '';
  document.getElementById('kpis-calendario').style.display = 'none';
  document.getElementById('filtros-periodo').style.display = 'none';

  fetch(url)
    .then(function(res) { return res.json(); })
    .then(function(data) {
      document.getElementById('cargando').style.display = 'none';
      if (data.exito) {
        todosLosEventos = data.eventos;
        try { localStorage.setItem(cacheKey, JSON.stringify({ ts: Date.now(), data: data.eventos })); } catch(e) {}
        document.getElementById('filtros-periodo').style.display = '';
        document.getElementById('kpis-calendario').style.display = '';
        actualizarKPIs();
        aplicarFiltros();
      } else {
        mostrarToast('danger', 'Error: ' + data.mensaje);
      }
    })
    .catch(function(err) {
      document.getElementById('cargando').style.display = 'none';
      mostrarToast('danger', 'Error de conexión');
    });
}

function recargar() {
  try { localStorage.removeItem('calEventos_' + new Date().getFullYear()); } catch(e) {}
  todosLosEventos = [];
  cargarTodosLosEventos();
}

function clasificarEvento(ev) {
  var info = ((ev.titulo || '') + ' ' + (ev.descripcion || '')).toLowerCase();
  var cal = (ev.calendario || '').toLowerCase();
  if (cal.indexOf('cumplea') !== -1 || cal.indexOf('aniversario') !== -1) return 'cumpleanos';
  if (info.indexOf('cumpleaño') !== -1 || info.indexOf('cumpleanos') !== -1 || info.indexOf('birthday') !== -1) return 'cumpleanos';
  if (info.indexOf('sala de situación') !== -1 || info.indexOf('sala dtra') !== -1 || info.indexOf('dtra-') !== -1) return 'sala';
  if (info.indexOf('reunión') !== -1 || info.indexOf('reunion') !== -1) return 'reuniones';
  if (info.indexOf('capacitación') !== -1 || info.indexOf('capacitacion') !== -1 || info.indexOf('curso') !== -1) return 'capacitaciones';
  if (info.indexOf('audiencia') !== -1 || info.indexOf('presentación') !== -1 || info.indexOf('presentacion') !== -1) return 'audiencias';
  if (info.indexOf('feriado') !== -1) return 'feriados';
  if (info.indexOf('compromiso') !== -1 || info.indexOf('agenda') !== -1) return 'compromisos';
  if (info.indexOf('viaje') !== -1 || info.indexOf('desplazamiento') !== -1) return 'viajes';
  return 'otros';
}

function asignarColor(tipo) {
  var colores = {
    cumpleanos: { fondo: '#f43f5e', borde: '#e11d48', texto: 'Cumpleaños', badge: 'bg-tipo-cumpleanos' },
    sala: { fondo: '#f59e0b', borde: '#d97706', texto: 'Sala de Situación', badge: 'bg-tipo-sala' },
    reuniones: { fondo: '#10b981', borde: '#059669', texto: 'Reunión', badge: 'bg-tipo-reuniones' },
    capacitaciones: { fondo: '#8b5cf6', borde: '#7c3aed', texto: 'Capacitación', badge: 'bg-tipo-capacitaciones' },
    audiencias: { fondo: '#3b82f6', borde: '#2563eb', texto: 'Audiencia', badge: 'bg-primary' },
    feriados: { fondo: '#ef4444', borde: '#dc2626', texto: 'Feriado', badge: 'bg-danger' },
    compromisos: { fondo: '#f97316', borde: '#ea580c', texto: 'Compromiso', badge: 'bg-tipo-compromiso' },
    viajes: { fondo: '#14b8a6', borde: '#0d9488', texto: 'Viaje', badge: 'bg-tipo-viaje' },
    otros: { fondo: '#6b7280', borde: '#4b5563', texto: 'Otro', badge: 'bg-tipo-otro' }
  };
  return colores[tipo] || colores.otros;
}

function parsearFecha(fechaStr) {
  var partes = fechaStr.split('T')[0].split('-');
  return new Date(parseInt(partes[0]), parseInt(partes[1]) - 1, parseInt(partes[2]));
}

function esHoy(fechaStr) {
  var hoy = new Date();
  var f = parsearFecha(fechaStr);
  return f.getFullYear() === hoy.getFullYear() && f.getMonth() === hoy.getMonth() && f.getDate() === hoy.getDate();
}

function esManana(fechaStr) {
  var manana = new Date();
  manana.setDate(manana.getDate() + 1);
  var f = parsearFecha(fechaStr);
  return f.getFullYear() === manana.getFullYear() && f.getMonth() === manana.getMonth() && f.getDate() === manana.getDate();
}

function estaEnPeriodo(ev) {
  var f = parsearFecha(ev.inicio);
  var hoy = new Date();
  hoy.setHours(0, 0, 0, 0);

  if (FILTRO_PERIODO === 'hoy') {
    return esHoy(ev.inicio);
  }
  if (FILTRO_PERIODO === 'semana') {
    var fin = new Date(hoy);
    fin.setDate(fin.getDate() + 7);
    return f >= hoy && f <= fin;
  }
  if (FILTRO_PERIODO === 'mes') {
    return f.getFullYear() === hoy.getFullYear() && f.getMonth() === hoy.getMonth();
  }
  if (FILTRO_PERIODO === 'anio') {
    return f.getFullYear() === hoy.getFullYear();
  }
  return true;
}

function cambiarPeriodo(periodo) {
  FILTRO_PERIODO = periodo;
  FILTRO_TIPO = null;

  document.querySelectorAll('[data-periodo]').forEach(function(btn) {
    btn.classList.toggle('active', btn.getAttribute('data-periodo') === periodo);
  });
  document.querySelectorAll('.cal-kpi-card').forEach(function(card) {
    card.classList.remove('activo');
  });
  document.getElementById('filtro-activo').style.display = 'none';

  actualizarKPIs();
  aplicarFiltros();
}

function filtrarTipo(tipo) {
  if (FILTRO_TIPO === tipo) {
    FILTRO_TIPO = null;
  } else {
    FILTRO_TIPO = tipo;
  }

  document.querySelectorAll('.cal-kpi-card').forEach(function(card) {
    card.classList.toggle('activo', card.getAttribute('data-tipo') === FILTRO_TIPO);
  });

  var pf = document.getElementById('filtro-activo');
  if (FILTRO_TIPO) {
    var color = asignarColor(FILTRO_TIPO);
    pf.style.display = '';
    document.getElementById('filtro-nombre').textContent = color.texto;
  } else {
    pf.style.display = 'none';
  }

  aplicarFiltros();
}

function limpiarFiltroTipo() {
  FILTRO_TIPO = null;
  document.querySelectorAll('.cal-kpi-card').forEach(function(card) {
    card.classList.remove('activo');
  });
  document.getElementById('filtro-activo').style.display = 'none';
  aplicarFiltros();
}

function actualizarKPIs() {
  var kpis = { sala: 0, reuniones: 0, capacitaciones: 0, cumpleanos: 0 };
  for (var i = 0; i < todosLosEventos.length; i++) {
    var ev = todosLosEventos[i];
    if (!estaEnPeriodo(ev)) continue;
    if (FECHA_BUSCAR_CAL) {
      var partes = ev.inicio.split('T')[0].split('-');
      var fEv = new Date(parseInt(partes[0]), parseInt(partes[1]) - 1, parseInt(partes[2]));
      if (fEv.getTime() !== FECHA_BUSCAR_CAL.getTime()) continue;
    }
    var tipo = clasificarEvento(ev);
    if (tipo === 'sala') kpis.sala++;
    else if (tipo === 'reuniones') kpis.reuniones++;
    else if (tipo === 'capacitaciones') kpis.capacitaciones++;
    else if (tipo === 'cumpleanos') kpis.cumpleanos++;
  }
  document.getElementById('kpi-sala').textContent = kpis.sala;
  document.getElementById('kpi-reuniones').textContent = kpis.reuniones;
  document.getElementById('kpi-capacitaciones').textContent = kpis.capacitaciones;
  document.getElementById('kpi-cumpleanos').textContent = kpis.cumpleanos;

  if (FECHA_BUSCAR_CAL) {
    var meses = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
    document.getElementById('periodo-info').textContent = '(' + FECHA_BUSCAR_CAL.getDate() + ' ' + meses[FECHA_BUSCAR_CAL.getMonth()] + ')';
  } else {
    var nombresPeriodo = { hoy: 'Hoy', semana: 'Próximos 7 días', mes: 'Este mes', anio: 'Este año' };
    document.getElementById('periodo-info').textContent = '(' + nombresPeriodo[FILTRO_PERIODO] + ')';
  }
}

function aplicarFiltros() {
  eventosFiltrados = todosLosEventos.filter(function(ev) {
    if (!estaEnPeriodo(ev)) return false;
    if (FILTRO_TIPO) {
      if (clasificarEvento(ev) !== FILTRO_TIPO) return false;
    }
    if (FECHA_BUSCAR_CAL) {
      var partes = ev.inicio.split('T')[0].split('-');
      var fEv = new Date(parseInt(partes[0]), parseInt(partes[1]) - 1, parseInt(partes[2]));
      if (fEv.getTime() !== FECHA_BUSCAR_CAL.getTime()) return false;
    }
    if (TEXTO_BUSQUEDA) {
      var busq = TEXTO_BUSQUEDA.toLowerCase();
      var info = ((ev.titulo || '') + ' ' + (ev.descripcion || '') + ' ' + (ev.ubicacion || '')).toLowerCase();
      if (info.indexOf(busq) === -1) return false;
    }
    return true;
  });

  eventosFiltrados.sort(function(a, b) {
    return a.inicio.localeCompare(b.inicio);
  });

  pagActual = 1;
  renderizarGantt();
  renderizarLista();
}

function renderizarGantt() {
  var cont = document.getElementById('gantt-dia');
  if (!FECHA_BUSCAR_CAL || eventosFiltrados.length === 0) {
    cont.style.display = 'none';
    cont.innerHTML = '';
    return;
  }

  // Separar eventos all-day de los que tienen hora
  var todoElDia = [];
  var conHora = [];
  for (var i = 0; i < eventosFiltrados.length; i++) {
    var ev = eventosFiltrados[i];
    if (ev.todoElDia || ev.inicio.indexOf('T') === -1) todoElDia.push(ev);
    else conHora.push(ev);
  }

  // Rango adaptivo: hora más temprana a más tardía, redondeado a horas pares
  var minHora = 24, maxHora = 0;
  function horasDec(fechaStr) {
    var t = fechaStr.split('T')[1];
    if (!t) return null;
    var p = t.split(':');
    return parseInt(p[0], 10) + parseInt(p[1], 10) / 60;
  }
  for (var i = 0; i < conHora.length; i++) {
    var hi = horasDec(conHora[i].inicio);
    var hf = horasDec(conHora[i].fin);
    if (hi === null) continue;
    if (hf === null || hf <= hi) hf = hi + 1;
    conHora[i]._hi = hi;
    conHora[i]._hf = hf;
    if (hi < minHora) minHora = hi;
    if (hf > maxHora) maxHora = hf;
  }
  if (minHora >= maxHora) { minHora = 8; maxHora = 22; }
  var rangoIni = Math.max(0, Math.floor(minHora / 2) * 2);
  var rangoFin = Math.min(24, Math.ceil(maxHora / 2) * 2);
  if (rangoFin - rangoIni < 2) rangoFin = Math.min(24, rangoIni + 2);
  var totalHoras = rangoFin - rangoIni;

  // Asignar lanes (carriles) a eventos que se solapan
  conHora.sort(function(a, b) { return a._hi - b._hi; });
  var lanes = []; // lanes[l] = hora de fin del último evento del carril
  var conflictos = {};
  for (var i = 0; i < conHora.length; i++) {
    var ev = conHora[i];
    var lane = -1;
    for (var l = 0; l < lanes.length; l++) {
      if (lanes[l] <= ev._hi + 0.01) { lane = l; break; }
    }
    if (lane === -1) { lane = lanes.length; lanes.push(0); }
    lanes[lane] = ev._hf;
    ev._lane = lane;
  }
  // Detectar conflictos: solape real entre eventos (distinto id)
  for (var i = 0; i < conHora.length; i++) {
    for (var j = i + 1; j < conHora.length; j++) {
      var a = conHora[i], b = conHora[j];
      if (a._hi < b._hf - 0.01 && b._hi < a._hf - 0.01) {
        conflictos[a.id] = true;
        conflictos[b.id] = true;
      }
    }
  }

  // Encabezado con escala de horas
  var pasos = totalHoras > 12 ? 2 : 1;
  var html = '<div class="gantt-titulo">📅 Horarios del día — ' +
    (FECHA_BUSCAR_CAL.getDate() + '/' + (FECHA_BUSCAR_CAL.getMonth() + 1) + '/' + FECHA_BUSCAR_CAL.getFullYear()) +
    '</div>';
  html += '<div class="gantt-eje">';
  html += '<div class="gantt-eje-espaciador"></div>';
  html += '<div class="gantt-eje-marcas">';
  for (var h = rangoIni; h <= rangoFin; h += pasos) {
    var pct = ((h - rangoIni) / totalHoras) * 100;
    html += '<span class="gantt-marca" style="left:' + pct + '%;">' + (h < 10 ? '0' : '') + h + ':00</span>';
  }
  html += '</div></div>';

  // Fila all-day arriba
  for (var i = 0; i < todoElDia.length; i++) {
    var ev = todoElDia[i];
    var tipo = clasificarEvento(ev);
    var color = asignarColor(tipo);
    html += '<div class="gantt-fila gantt-fila-allday">';
    html += '<div class="gantt-fila-etiqueta">Todo el día</div>';
    html += '<div class="gantt-pista">';
    html += '<div class="gantt-barra gantt-barra-allday' + (conflictos[ev.id] ? ' conflicto' : '') + '" ' +
      'style="background:' + color.fondo + ';" onclick="verDetalle(\'' + ev.id.replace(/'/g, "\\'") + '\')" ' +
      'title="' + (ev.titulo || '').replace(/"/g, '&quot;') + '">' +
      '🎂 ' + (ev.titulo || 'Sin título') + '</div>';
    html += '</div></div>';
  }

  // Filas por carril
  for (var l = 0; l < lanes.length; l++) {
    html += '<div class="gantt-fila">';
    html += '<div class="gantt-fila-etiqueta"></div>';
    html += '<div class="gantt-pista">';
    // Líneas de grilla horaria
    for (var h = rangoIni; h <= rangoFin; h += pasos) {
      var pct = ((h - rangoIni) / totalHoras) * 100;
      html += '<div class="gantt-linea" style="left:' + pct + '%;"></div>';
    }
    for (var i = 0; i < conHora.length; i++) {
      var ev = conHora[i];
      if (ev._lane !== l) continue;
      var tipo = clasificarEvento(ev);
      var color = asignarColor(tipo);
      var izq = ((ev._hi - rangoIni) / totalHoras) * 100;
      var ancho = ((ev._hf - ev._hi) / totalHoras) * 100;
      var horaTxt = formatearHora(ev.inicio) + ' a ' + formatearHora(ev.fin);
      html += '<div class="gantt-barra' + (conflictos[ev.id] ? ' conflicto' : '') + '" ' +
        'style="left:' + izq + '%;width:' + ancho + '%;background:' + color.fondo + ';" ' +
        'onclick="verDetalle(\'' + ev.id.replace(/'/g, "\\'") + '\')" ' +
        'title="' + (ev.titulo || '').replace(/"/g, '&quot;') + ' — ' + horaTxt + '">' +
        '<span class="gantt-barra-texto">' + (ev.titulo || 'Sin título') + '</span>' +
        '<span class="gantt-barra-hora">' + horaTxt + '</span></div>';
    }
    html += '</div></div>';
  }

  cont.innerHTML = html;
  cont.style.display = '';
}

function renderizarLista() {
  var tam = parseInt(document.getElementById('pag-tamanio').value);
  var total = eventosFiltrados.length;
  var contador = document.getElementById('fecha-contador');
  if (FECHA_BUSCAR_CAL) {
    contador.style.display = '';
    contador.textContent = total;
  } else {
    contador.style.display = 'none';
  }
  var desde = (pagActual - 1) * tam;
  var hasta = Math.min(desde + tam, total);
  var eventosPagina = eventosFiltrados.slice(desde, hasta);

  var lista = document.getElementById('lista-eventos');
  var vacio = document.getElementById('vacio');
  var paginador = document.getElementById('paginador');
  var controles = document.getElementById('controles-paginacion');

  if (total === 0) {
    lista.innerHTML = '';
    vacio.style.display = '';
    paginador.style.display = 'none';
    controles.style.display = 'none';
    return;
  }

  vacio.style.display = 'none';

  var html = '';
  for (var i = 0; i < eventosPagina.length; i++) {
    var ev = eventosPagina[i];
    var tipo = clasificarEvento(ev);
    var color = asignarColor(tipo);
    var esTodoElDia = ev.todoElDia;

    var clases = ['cal-event-card', 'mb-3'];
    if (esHoy(ev.inicio)) clases.push('hoy-reserva');
    else if (esManana(ev.inicio)) clases.push('manana');

    var horaInicio = esTodoElDia ? '' : formatearHora(ev.inicio);
    var horaFin = esTodoElDia ? '' : formatearHora(ev.fin);
    var horario = esTodoElDia ? 'Todo el día' : (horaInicio + ' a ' + horaFin);
    var fecha = formatearFechaCorta(ev.inicio);

    var badgeHoy = esHoy(ev.inicio) ? '<span class="badge bg-warning text-dark" style="font-size:9px;">HOY</span>' : '';
    var badgeManana = esManana(ev.inicio) ? '<span class="badge bg-primary" style="font-size:9px;">MAÑANA</span>' : '';

    html += '<div class="' + clases.join(' ') + '" data-tipo="' + tipo + '" onclick="verDetalle(\'' + ev.id + '\')">';
    html += '<div class="d-flex justify-content-between align-items-start">';
    html += '<div class="flex-grow-1">';
    html += '<div class="d-flex align-items-center gap-2 mb-1">';
    html += '<span class="badge ' + color.badge + '" style="font-size:10px;">' + color.texto + '</span>';
    html += badgeHoy + badgeManana;
    html += '</div>';
    html += '<h6 class="fw-bold mb-1" style="font-size:14px;color:#1e1b4b;">' + (ev.titulo || 'Sin título') + '</h6>';
    html += '<div class="d-flex gap-3 flex-wrap">';
    html += '<span class="cal-event-date-badge' + (esHoy(ev.inicio) ? ' hoy' : '') + '">📅 ' + fecha + '</span>';
    html += '<span class="text-secondary" style="font-size:12px;">🕐 ' + horario + '</span>';
    if (ev.ubicacion) {
      html += '<span class="text-secondary" style="font-size:12px;">📍 ' + ev.ubicacion + '</span>';
    }
    html += '</div>';
    if (ev.descripcion) {
      html += '<div class="text-muted mt-1" style="font-size:12px;max-height:32px;overflow:hidden;">' + ev.descripcion + '</div>';
    }
    html += '</div>';
    html += '<span style="font-size:10px;color:#9ca3af;font-weight:600;">Ver →</span>';
    html += '</div>';
    html += '</div>';
  }

  lista.innerHTML = html;

  document.getElementById('pag-desde').textContent = total > 0 ? desde + 1 : 0;
  document.getElementById('pag-hasta').textContent = hasta;
  document.getElementById('pag-total').textContent = total;
  controles.style.display = '';

  if (total > tam) {
    paginador.style.display = '';
    renderizarPaginador(tam, total);
  } else {
    paginador.style.display = 'none';
  }
}

function renderizarPaginador(tam, total) {
  var paginas = Math.ceil(total / tam);
  var html = '';
  var inicio = Math.max(1, pagActual - 2);
  var fin = Math.min(paginas, pagActual + 2);
  if (fin - inicio < 4) {
    if (inicio === 1) fin = Math.min(paginas, 5);
    else inicio = Math.max(1, paginas - 4);
  }
  for (var i = inicio; i <= fin; i++) {
    html += '<button class="page-link' + (i === pagActual ? ' active' : '') + '" onclick="cambiarPagina(' + i + ')">' + i + '</button>';
  }
  document.getElementById('pag-paginas').innerHTML = html;
}

function cambiarPagina(p) {
  var paginas = Math.ceil(eventosFiltrados.length / parseInt(document.getElementById('pag-tamanio').value));
  if (p < 1 || p > paginas) return;
  pagActual = p;
  renderizarLista();
  window.scrollTo(0, 0);
}

function buscarFechaCal(valor) {
  if (valor) {
    var p = valor.split('-');
    FECHA_BUSCAR_CAL = new Date(parseInt(p[0]), parseInt(p[1]) - 1, parseInt(p[2]));
    document.getElementById('btn-clear-fecha').style.display = '';
  } else {
    FECHA_BUSCAR_CAL = null;
    document.getElementById('btn-clear-fecha').style.display = 'none';
  }
  FILTRO_TIPO = null;
  document.querySelectorAll('.cal-kpi-card').forEach(function(c) { c.classList.remove('activo'); });
  document.getElementById('filtro-activo').style.display = 'none';
  document.getElementById('fecha-contador').style.display = FECHA_BUSCAR_CAL ? '' : 'none';
  pagActual = 1;
  actualizarKPIs();
  aplicarFiltros();
}

function limpiarFechaCal() {
  FECHA_BUSCAR_CAL = null;
  document.getElementById('fecha-buscar').value = '';
  document.getElementById('btn-clear-fecha').style.display = 'none';
  document.getElementById('fecha-contador').style.display = 'none';
  pagActual = 1;
  actualizarKPIs();
  aplicarFiltros();
}

function buscarEventos(texto) {
  TEXTO_BUSQUEDA = texto.trim();
  pagActual = 1;
  aplicarFiltros();
}

function formatearFechaCorta(fechaStr) {
  var f = parsearFecha(fechaStr);
  var dias = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
  var meses = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
  return dias[f.getDay()] + ' ' + f.getDate() + ' ' + meses[f.getMonth()] + ' ' + f.getFullYear();
}

function formatearFechaLarga(fechaStr) {
  var f = parsearFecha(fechaStr);
  var opciones = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
  return f.toLocaleDateString('es-AR', opciones);
}

function formatearHora(horaStr) {
  if (!horaStr || horaStr.indexOf('T') === -1) return '';
  var partes = horaStr.split('T')[1].split(':');
  return partes[0] + ':' + partes[1];
}

function formatearFechaInput(fechaStr) {
  if (!fechaStr) return '';
  var f = parsearFecha(fechaStr);
  var year = f.getFullYear();
  var month = ('0' + (f.getMonth() + 1)).slice(-2);
  var day = ('0' + f.getDate()).slice(-2);
  return year + '-' + month + '-' + day;
}

function verDetalle(id) {
  var ev = null;
  for (var i = 0; i < todosLosEventos.length; i++) {
    if (todosLosEventos[i].id === id) { ev = todosLosEventos[i]; break; }
  }
  if (!ev) return;

  eventoSeleccionadoId = id;
  var tipo = clasificarEvento(ev);
  var color = asignarColor(tipo);

  document.getElementById('modal-ver-header').className = 'modal-header text-white';
  document.getElementById('modal-ver-header').style.backgroundColor = color.fondo;
  document.getElementById('ver-tipo').textContent = color.texto;
  document.getElementById('ver-tipo').className = 'badge ' + color.badge;
  document.getElementById('ver-titulo').textContent = ev.titulo || 'Sin título';

  if (ev.todoElDia) {
    document.getElementById('ver-fecha').textContent = formatearFechaLarga(ev.inicio);
    document.getElementById('ver-horario').textContent = 'Todo el día';
  } else {
    document.getElementById('ver-fecha').textContent = formatearFechaLarga(ev.inicio);
    document.getElementById('ver-horario').textContent = formatearHora(ev.inicio) + ' a ' + formatearHora(ev.fin);
  }

  var desc = ev.descripcion || '';
  document.getElementById('ver-descripcion').textContent = desc || 'Sin descripción';
  document.getElementById('ver-descripcion-container').style.display = desc ? '' : 'none';

  var loc = ev.ubicacion || '';
  document.getElementById('ver-ubicacion').textContent = loc;
  document.getElementById('ver-ubicacion-container').style.display = loc ? '' : 'none';

  var modal = new bootstrap.Modal(document.getElementById('modalVerEvento'));
  modal.show();
}

function toggleTipoCustom() {
  var select = document.getElementById('crear-tipo').value;
  document.getElementById('tipo-custom-box').style.display = select === 'Otro' ? '' : 'none';
}

function abrirModalCrear() {
  document.getElementById('crear-tipo').value = 'Reunión';
  document.getElementById('crear-tipoCustom').value = '';
  document.getElementById('tipo-custom-box').style.display = 'none';
  document.getElementById('crear-titulo').value = '';
  document.getElementById('crear-horaInicio').value = '09:00';
  document.getElementById('crear-horaFin').value = '10:00';
  document.getElementById('crear-descripcion').value = '';
  document.getElementById('crear-ubicacion').value = '';

  var hoy = new Date();
  document.getElementById('crear-fecha').value = hoy.toISOString().split('T')[0];

  var modal = new bootstrap.Modal(document.getElementById('modalCrearEvento'));
  modal.show();
}

async function guardarEvento() {
  var tipoSelect = document.getElementById('crear-tipo').value;
  var tipoCustom = document.getElementById('crear-tipoCustom').value.trim();
  var tipo = tipoSelect === 'Otro' ? tipoCustom : tipoSelect;
  var titulo = document.getElementById('crear-titulo').value.trim();
  var fecha = document.getElementById('crear-fecha').value;
  var horaInicio = document.getElementById('crear-horaInicio').value;
  var horaFin = document.getElementById('crear-horaFin').value;
  var descripcion = document.getElementById('crear-descripcion').value.trim();
  var ubicacion = document.getElementById('crear-ubicacion').value.trim();

  if (!tipo || !titulo || !fecha) {
    mostrarToast('warning', 'Completá los campos obligatorios');
    return;
  }

  var tituloCompleto = tipo + ' - ' + titulo;

  var partesFecha = fecha.split('-');
  var inicio, fin;

  var debugForm = 'tipo=[' + tipoSelect + '] horaInicio=[' + horaInicio + '] horaFin=[' + horaFin + ']';

  if (!horaInicio && !horaFin) {
    // Sin horarios: all-day 00:00 a 23:59
    inicio = new Date(parseInt(partesFecha[0]), parseInt(partesFecha[1]) - 1, parseInt(partesFecha[2]), 0, 0);
    fin = new Date(parseInt(partesFecha[0]), parseInt(partesFecha[1]) - 1, parseInt(partesFecha[2]), 23, 59);
  } else {
    if (!horaInicio || !horaFin) {
      mostrarToast('warning', 'Completá los horarios');
      return;
    }
    var partesInicio = horaInicio.split(':');
    var partesFin = horaFin.split(':');
    inicio = new Date(parseInt(partesFecha[0]), parseInt(partesFecha[1]) - 1, parseInt(partesFecha[2]),
      parseInt(partesInicio[0]), parseInt(partesInicio[1]));
    fin = new Date(parseInt(partesFecha[0]), parseInt(partesFecha[1]) - 1, parseInt(partesFecha[2]),
      parseInt(partesFin[0]), parseInt(partesFin[1]));
    if (fin <= inicio) {
      mostrarToast('warning', 'La hora de fin debe ser posterior a la de inicio');
      return;
    }
  }

  // Determinar si es edición o creación nueva
  var esEdicion = !!eventoSeleccionadoId;
  var accion = esEdicion ? 'editarEventoCalendario' : 'crearEventoCalendario';

  // Datos originales para fallback de búsqueda
  var evOriginal = null;
  if (esEdicion) {
    for (var i = 0; i < todosLosEventos.length; i++) {
      if (todosLosEventos[i].id === eventoSeleccionadoId) { evOriginal = todosLosEventos[i]; break; }
    }
  }

  var modal = bootstrap.Modal.getInstance(document.getElementById('modalCrearEvento'));
  modal.hide();

  try {
    var res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({
        action: accion,
        datos: {
          titulo: tituloCompleto,
          inicio: inicio.toISOString(),
          fin: fin.toISOString(),
          descripcion: descripcion,
          ubicacion: ubicacion,
          eventoId: esEdicion ? eventoSeleccionadoId : undefined,
          tituloOriginal: evOriginal ? evOriginal.titulo : undefined,
          inicioOriginal: evOriginal ? evOriginal.inicio : undefined
        }
      })
    });
    var data = await res.json();
    mostrarToast(data.exito ? 'success' : 'danger', data.mensaje + ' || FORM: ' + debugForm);
    if (data.exito) recargar();
    eventoSeleccionadoId = null;
  } catch (err) {
    mostrarToast('danger', 'Error de conexión');
  }
}

async function eliminarEvento() {
  if (!eventoSeleccionadoId) return;
  if (!confirm('¿Eliminar este evento del calendario?')) return;

  var modal = bootstrap.Modal.getInstance(document.getElementById('modalVerEvento'));
  modal.hide();

  try {
    // Obtenemos el evento para saber su calendario
    var ev = null;
    for (var i = 0; i < todosLosEventos.length; i++) {
      if (todosLosEventos[i].id === eventoSeleccionadoId) { ev = todosLosEventos[i]; break; }
    }
    
    var calendarioId = ev ? ev.calendario : null;
    
    var res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({
        action: 'eliminarEventoCalendario',
        eventoId: eventoSeleccionadoId,
        titulo: ev ? ev.titulo : null,
        inicio: ev ? ev.inicio : null
      })
    });
    var data = await res.json();
    mostrarToast(data.exito ? 'success' : 'danger', data.mensaje);
    if (data.exito) recargar();
  } catch (err) {
    mostrarToast('danger', 'Error de conexión');
  }
  eventoSeleccionadoId = null;
}

async function editarEvento() {
  if (!eventoSeleccionadoId) return;

  // Cargar datos del evento seleccionado
  var ev = null;
  for (var i = 0; i < todosLosEventos.length; i++) {
    if (todosLosEventos[i].id === eventoSeleccionadoId) { ev = todosLosEventos[i]; break; }
  }
  if (!ev) return;

  // Determinar tipo de evento para el select
  var tipo = clasificarEvento(ev);
  var tipoMapa = {
    'cumpleanos': 'Cumpleaños',
    'reuniones': 'Reunión',
    'capacitaciones': 'Capacitación',
    'audiencias': 'Audiencia',
    'sala': 'Reunión',
    'compromisos': 'Compromiso',
    'viajes': 'Viaje',
    'otros': 'Otro'
  };
  document.getElementById('crear-tipo').value = tipoMapa[tipo] || 'Otro';

  // Si es "Otro", mostrar campo custom con el tipo original
  if (!tipoMapa[tipo] || tipoMapa[tipo] === 'Otro') {
    document.getElementById('crear-tipo').value = 'Otro';
    document.getElementById('crear-tipoCustom').value = ev.calendario || 'Otro';
  }
  toggleTipoCustom();

  // Título: quitar el prefijo "Tipo - " si existe
  var titulo = ev.titulo || '';
  var match = titulo.match(/^[^-]+ - (.+)$/);
  if (match) titulo = match[1];
  document.getElementById('crear-titulo').value = titulo;

  // Fecha
  document.getElementById('crear-fecha').value = formatearFechaInput(ev.inicio);

  // Horarios (all-day eventos no tienen hora)
  var horaInicio = formatearHora(ev.inicio);
  var horaFin = formatearHora(ev.fin);
  document.getElementById('crear-horaInicio').value = horaInicio || '';
  document.getElementById('crear-horaFin').value = horaFin || '';

  document.getElementById('crear-descripcion').value = ev.descripcion || '';
  document.getElementById('crear-ubicacion').value = ev.ubicacion || '';

  // Mostrar modal y ocultar el de ver detalle
  var modalVer = bootstrap.Modal.getInstance(document.getElementById('modalVerEvento'));
  modalVer.hide();
  var modalCrear = new bootstrap.Modal(document.getElementById('modalCrearEvento'));
  modalCrear.show();
}

// ... rest of the file

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
