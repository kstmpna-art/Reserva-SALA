var API_URL = 'https://script.google.com/macros/s/AKfycby8s7CwxJlElbSbhgrvkPmtSejCvSavQ4QW3UoJZdpPO_NtFrgb6h1fxE-hfSrNtIbc/exec';

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

function claveCacheCal() {
  return 'calEventos_' + new Date().getFullYear();
}

function cargarCacheCal() {
  try {
    var raw = localStorage.getItem(claveCacheCal());
    if (!raw) return null;
    var obj = JSON.parse(raw);
    if (obj && obj.data && obj.data.length) return obj;
  } catch (e) {}
  return null;
}

function pintarEventos() {
  document.getElementById('cargando').style.display = 'none';
  document.getElementById('filtros-periodo').style.display = '';
  document.getElementById('kpis-calendario').style.display = '';
  actualizarKPIs();
  aplicarFiltros();
}

function cargarTodosLosEventos() {
  var hoy = new Date();
  var desde = new Date(hoy.getFullYear(), 0, 1);
  var hasta = new Date(hoy.getFullYear(), 11, 31, 23, 59, 59);

  // 1) Mostrar cache al instante (si existe) sin spinner
  var cache = cargarCacheCal();
  if (cache) {
    todosLosEventos = cache.data;
    pintarEventos();
    refrescarEventosEnSegundoPlano(desde, hasta);
    return;
  }

  // 2) Sin cache: carga completa con spinner
  document.getElementById('cargando').style.display = '';
  document.getElementById('kpis-calendario').style.display = 'none';
  document.getElementById('filtros-periodo').style.display = 'none';
  obtenerEventosAPI(desde, hasta).then(function(data) {
    document.getElementById('cargando').style.display = 'none';
    if (data && data.exito) {
      todosLosEventos = data.eventos;
      try { localStorage.setItem(claveCacheCal(), JSON.stringify({ ts: Date.now(), data: data.eventos })); } catch (e) {}
      pintarEventos();
    } else {
      mostrarToast('danger', 'Error: ' + (data && data.mensaje ? data.mensaje : 'desconocido'));
    }
  }).catch(function() {
    document.getElementById('cargando').style.display = 'none';
    mostrarToast('danger', 'Error de conexión');
  });
}

function refrescarEventosEnSegundoPlano(desde, hasta) {
  obtenerEventosAPI(desde, hasta).then(function(data) {
    if (data && data.exito) {
      var cacheActual = cargarCacheCal();
      var viejo = cacheActual ? JSON.stringify(cacheActual.data) : '';
      var nuevo = JSON.stringify(data.eventos);
      todosLosEventos = data.eventos;
      try { localStorage.setItem(claveCacheCal(), JSON.stringify({ ts: Date.now(), data: data.eventos })); } catch (e) {}
      // Re-pintar solo si cambiaron datos (si no, ya se pintó con el cache)
      if (viejo !== nuevo) pintarEventos();
    }
    // Si falla, se sigue mostrando el cache sin interrumpir
  }).catch(function() {});
}

function obtenerEventosAPI(desde, hasta) {
  var url = API_URL + '?action=obtenerEventosCalendario&desde=' + encodeURIComponent(desde.toISOString()) + '&hasta=' + encodeURIComponent(hasta.toISOString());
  return fetch(url).then(function(res) { return res.json(); });
}

function recargar() {
  try { localStorage.removeItem(claveCacheCal()); } catch(e) {}
  todosLosEventos = [];
  cargarTodosLosEventos();
}

// ============================================================
// IMPORTACIÓN DE AGENDA DESDE TXT
// ============================================================
var MESES_AGENDA = { ENE:1, FEB:2, MAR:3, ABR:4, MAY:5, JUN:6, JUL:7, AGO:8, SEP:9, OCT:10, NOV:11, DIC:12 };
var agendaParseada = [];

function abrirImportarTxt() {
  document.getElementById('import-txt-archivo').value = '';
  document.getElementById('import-preview').style.display = 'none';
  document.getElementById('import-avisos').style.display = 'none';
  document.getElementById('import-btn-ejecutar').disabled = true;
  document.getElementById('import-btn-ejecutar').textContent = 'Importar seleccionados (0)';
  agendaParseada = [];
  var modal = new bootstrap.Modal(document.getElementById('modalImportarTxt'));
  modal.show();
}

function leerArchivoAgenda(input) {
  var file = input.files && input.files[0];
  if (!file) return;
  var lector = new FileReader();
  lector.onload = function(e) {
    var res = parsearAgendaTxt(e.target.result);
    agendaParseada = res.eventos;
    renderizarPreviewAgenda(res);
  };
  lector.readAsText(file, 'utf-8');
}

function parsearAgendaTxt(texto) {
  texto = String(texto || '').replace(/^\uFEFF/, '');
  var lineas = texto.split(/\r?\n/);
  var hoy = new Date();
  var anioBase = hoy.getFullYear();
  var mesActual = hoy.getMonth() + 1;
  var eventos = [];
  var avisos = [];

  var RE_RANGO   = /^(\d{1,2})\s+(?:AL)\s+(\d{1,2})\s*\/?\s*([A-Za-zÁÉÍÓÚÑñ]{3,})\s*(.*)$/i;
  var RE_LISTA3  = /^(\d{1,2})\s*,\s*(\d{1,2})\s+(?:Y)\s+(\d{1,2})\s*\/?\s*([A-Za-zÁÉÍÓÚÑñ]{3,})\s*(.*)$/i;
  var RE_LISTA2  = /^(\d{1,2})\s+(?:Y)\s+(\d{1,2})\s*\/\s*([A-Za-zÁÉÍÓÚÑñ]{3,})\s*(.*)$/i;
  var RE_SIMPLE  = /^(\d{1,2})\s*\/\s*([A-Za-zÁÉÍÓÚÑñ]{3,})\s*(.*)$/;

  for (var i = 0; i < lineas.length; i++) {
    var linea = lineas[i].replace(/\t/g, ' ').trim();
    if (!linea) continue;

    var m, dias = [], mesStr = null, resto = null;

    if ((m = linea.match(RE_LISTA3))) {
      dias = [parseInt(m[1],10), parseInt(m[2],10), parseInt(m[3],10)];
      mesStr = m[4]; resto = m[5];
    } else if ((m = linea.match(RE_RANGO))) {
      dias = [parseInt(m[1],10), parseInt(m[2],10)];
      mesStr = m[3]; resto = m[4];
    } else if ((m = linea.match(RE_LISTA2))) {
      dias = [parseInt(m[1],10), parseInt(m[2],10)];
      mesStr = m[3]; resto = m[4];
    } else if ((m = linea.match(RE_SIMPLE))) {
      dias = [parseInt(m[1],10)];
      mesStr = m[2]; resto = m[3];
    } else {
      avisos.push('Línea ' + (i + 1) + ' no reconocida: ' + linea.substring(0, 80));
      continue;
    }

    var claveMes = mesStr.substring(0, 3).toUpperCase();
    var mes = MESES_AGENDA[claveMes];
    if (!mes || isNaN(dias[0])) {
      avisos.push('Línea ' + (i + 1) + ' con fecha inválida: ' + linea.substring(0, 80));
      continue;
    }

    // Año: actual; si el mes quedó "atrasado" cruzando dic→ene, año siguiente
    var anio = anioBase;
    if (mes < mesActual && (mesActual - mes) > 6) anio = anio + 1;

    var diaIni = Math.min.apply(null, dias);
    var diaFin = Math.max.apply(null, dias);
    var horario = parsearHorarioAgenda(resto || '');
    var ev = null;

    if (dias.length > 1) {
      // Rango de días → evento todo el día que abarca del día 1 al último
      var tituloR = limpiarTituloAgenda(resto || '');
      if (!tituloR) { avisos.push('Línea ' + (i + 1) + ' sin título: ' + linea.substring(0, 80)); continue; }
      ev = {
        titulo: tituloR,
        todoElDia: true,
        inicio: fmtFechaISO(anio, mes, diaIni),
        fin: fmtFechaISO(anio, mes, diaFin),
        _fechaTxt: diaIni + '/' + mes + '/' + anio + (dias.length > 1 ? ' al ' + diaFin + '/' + mes : ''),
        _horaTxt: 'Todo el día',
        _porConfirmar: false
      };
    } else {
      var h1, m1, h2, m2, porConfirmar = false;
      if (horario) {
        h1 = horario.h1; m1 = horario.m1; h2 = horario.h2; m2 = horario.m2;
        resto = resto.substring(horario.texto.length);
      } else {
        // Sin horario parseable (o "a confirmar") → 07:00 a 19:00
        h1 = 7; m1 = 0; h2 = 19; m2 = 0;
        porConfirmar = true;
        resto = resto.replace(/^(?:HORARIO|HORA)\s+A\s+CONFIRMAR\.?/i, '').replace(/^A\s+CONFIRMAR\.?/i, '');
      }
      var titulo = limpiarTituloAgenda(resto || '');
      if (!titulo) { avisos.push('Línea ' + (i + 1) + ' sin título: ' + linea.substring(0, 80)); continue; }

      var ini = new Date(anio, mes - 1, dias[0], h1, m1);
      var fin = new Date(anio, mes - 1, dias[0], h2, m2);
      if (fin <= ini) fin = new Date(ini.getTime() + 3600000);

      ev = {
        titulo: titulo,
        inicio: ini.toISOString(),
        fin: fin.toISOString(),
        _fechaTxt: dias[0] + '/' + mes + '/' + anio,
        _horaTxt: pad2(h1) + ':' + pad2(m1) + ' a ' + pad2(h2) + ':' + pad2(m2) + (porConfirmar ? ' *' : ''),
        _porConfirmar: porConfirmar
      };
    }
    eventos.push(ev);
  }
  return { eventos: eventos, avisos: avisos };
}

function parsearHorarioAgenda(resto) {
  var m;
  // Rango con minutos: 18.30 A 21 .00 / 11:00 A 12:30
  if ((m = resto.match(/^\s*(\d{1,2})\s*[:.]\s*(\d{2})\s*[Aa]\s*(\d{1,2})\s*[:.]?\s*(\d{2})/)))
    return { h1:+m[1], m1:+m[2], h2:+m[3], m2:+m[4], texto:m[0] };
  // Rango solo horas: 09 A 17HS / 10 A 12HS
  if ((m = resto.match(/^\s*(\d{1,2})\s*[Aa]\s*(\d{1,2})\s*HS/i)))
    return { h1:+m[1], m1:0, h2:+m[2], m2:0, texto:m[0] };
  // Hora con minutos: 11:00 / 11.45 / 10.00HS (duración 1h)
  if ((m = resto.match(/^\s*(\d{1,2})\s*[:.]\s*(\d{2})/))) {
    var h = +m[1];
    return { h1:h, m1:+m[2], h2:(h + 1 > 23 ? 23 : h + 1), m2:(h + 1 > 23 ? 59 : +m[2]), texto:m[0] };
  }
  // Solo hora: 10 HS (duración 1h)
  if ((m = resto.match(/^\s*(\d{1,2})\s*HS\b/i))) {
    var h2s = +m[1];
    return { h1:h2s, m1:0, h2:(h2s + 1 > 23 ? 23 : h2s + 1), m2:(h2s + 1 > 23 ? 59 : 0), texto:m[0] };
  }
  return null;
}

function limpiarTituloAgenda(t) {
  t = String(t || '').replace(/\s+/g, ' ').trim();
  t = t.replace(/^(?:HS\.?\s*[-.–—]?\s*|[-.–—]\s*)+/i, '');
  t = t.replace(/^(?:HORARIO|HORA)\s+A\s+CONFIRMAR\.?\s*[-.–—]?\s*/i, '');
  t = t.replace(/^A\s+CONFIRMAR\.?\s*[-.–—]?\s*/i, '');
  return t.trim();
}

function pad2(n) { return (n < 10 ? '0' : '') + n; }

function fmtFechaISO(anio, mes, dia) {
  return anio + '-' + pad2(mes) + '-' + pad2(dia);
}

function escAgenda(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function renderizarPreviewAgenda(res) {
  var cont = document.getElementById('import-preview');
  var cuerpo = document.getElementById('import-preview-body');
  var resumen = document.getElementById('import-resumen');

  if (res.eventos.length === 0) {
    cont.style.display = 'none';
    mostrarToast('warning', 'No se reconoció ningún evento en el archivo');
    return;
  }

  var html = '';
  for (var i = 0; i < res.eventos.length; i++) {
    var ev = res.eventos[i];
    html += '<tr>';
    html += '<td><input type="checkbox" class="import-check" data-i="' + i + '" checked onchange="actualizarBtnImport()"></td>';
    html += '<td style="white-space:nowrap;">' + escAgenda(ev._fechaTxt) + '</td>';
    html += '<td style="white-space:nowrap;">' + escAgenda(ev._horaTxt) + (ev._porConfirmar ? '' : '') + '</td>';
    html += '<td>' + escAgenda(ev.titulo) + '</td>';
    html += '</tr>';
  }
  cuerpo.innerHTML = html;

  resumen.innerHTML = res.eventos.length + ' evento(s) detectado(s)' +
    (res.avisos.length ? ' · <span style="color:#b45309;">' + res.avisos.length + ' línea(s) no reconocida(s)</span>' : '') +
    '<br><span style="font-size:11px;color:#6b7280;font-weight:400;">* Sin horario en el TXT → horario por defecto 07:00 a 19:00. Los rangos de días se importan como todo el día.</span>';

  var avisosDiv = document.getElementById('import-avisos');
  if (res.avisos.length) {
    var lista = '<strong>Líneas ignoradas:</strong><ul>';
    for (var j = 0; j < res.avisos.length; j++) lista += '<li>' + escAgenda(res.avisos[j]) + '</li>';
    avisosDiv.innerHTML = lista + '</ul>';
    avisosDiv.style.display = '';
  } else {
    avisosDiv.style.display = 'none';
  }

  cont.style.display = '';
  document.getElementById('import-check-all').checked = true;
  actualizarBtnImport();
}

function toggleImportTodos(marcar) {
  document.querySelectorAll('.import-check').forEach(function(c) { c.checked = marcar; });
  actualizarBtnImport();
}

function actualizarBtnImport() {
  var n = document.querySelectorAll('.import-check:checked').length;
  var btn = document.getElementById('import-btn-ejecutar');
  btn.textContent = 'Importar seleccionados (' + n + ')';
  btn.disabled = n === 0;
}

async function importarEventosTxt() {
  var seleccionados = [];
  document.querySelectorAll('.import-check:checked').forEach(function(c) {
    var ev = agendaParseada[parseInt(c.getAttribute('data-i'), 10)];
    if (ev) seleccionados.push({ titulo: ev.titulo, inicio: ev.inicio, fin: ev.fin, todoElDia: !!ev.todoElDia });
  });
  if (!seleccionados.length) return;

  var btn = document.getElementById('import-btn-ejecutar');
  btn.disabled = true;
  btn.textContent = 'Importando...';

  try {
    var res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ action: 'importarEventosCalendario', datos: { eventos: seleccionados } })
    });
    var data = await res.json();
    mostrarToast(data.exito ? 'success' : 'danger', data.mensaje);
    if (data.exito) {
      var modal = bootstrap.Modal.getInstance(document.getElementById('modalImportarTxt'));
      if (modal) modal.hide();
      recargar();
    }
  } catch (err) {
    mostrarToast('danger', 'Error de conexión');
  }
  btn.disabled = false;
  actualizarBtnImport();
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
    if (FECHA_BUSCAR_CAL) {
      // La fecha elegida tiene prioridad sobre el período
      var partes = ev.inicio.split('T')[0].split('-');
      var fEv = new Date(parseInt(partes[0]), parseInt(partes[1]) - 1, parseInt(partes[2]));
      if (fEv.getTime() !== FECHA_BUSCAR_CAL.getTime()) continue;
    } else if (!estaEnPeriodo(ev)) continue;
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
    if (FECHA_BUSCAR_CAL) {
      // La fecha elegida tiene prioridad sobre el período
      var partes = ev.inicio.split('T')[0].split('-');
      var fEv = new Date(parseInt(partes[0]), parseInt(partes[1]) - 1, parseInt(partes[2]));
      if (fEv.getTime() !== FECHA_BUSCAR_CAL.getTime()) return false;
    } else if (!estaEnPeriodo(ev)) return false;
    if (FILTRO_TIPO) {
      if (clasificarEvento(ev) !== FILTRO_TIPO) return false;
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

  // Día a mostrar: el elegido o, por defecto, hoy
  var fechaRef = FECHA_BUSCAR_CAL || new Date();
  fechaRef = new Date(fechaRef.getFullYear(), fechaRef.getMonth(), fechaRef.getDate());

  // Eventos del día de referencia (respetando filtros de tipo y texto)
  var eventosDia = [];
  for (var i = 0; i < todosLosEventos.length; i++) {
    var ev = todosLosEventos[i];
    var partes = ev.inicio.split('T')[0].split('-');
    var fEv = new Date(parseInt(partes[0]), parseInt(partes[1]) - 1, parseInt(partes[2]));
    if (fEv.getTime() !== fechaRef.getTime()) continue;
    if (FILTRO_TIPO && clasificarEvento(ev) !== FILTRO_TIPO) continue;
    if (TEXTO_BUSQUEDA) {
      var busq = TEXTO_BUSQUEDA.toLowerCase();
      var info = ((ev.titulo || '') + ' ' + (ev.descripcion || '') + ' ' + (ev.ubicacion || '')).toLowerCase();
      if (info.indexOf(busq) === -1) continue;
    }
    eventosDia.push(ev);
  }

  if (eventosDia.length === 0) {
    cont.innerHTML = '<div class="gantt-titulo">📅 Horarios del día — ' +
      (fechaRef.getDate() + '/' + (fechaRef.getMonth() + 1) + '/' + fechaRef.getFullYear()) +
      '</div><div class="gantt-vacio">No hay eventos con horario para este día.</div>';
    cont.style.display = '';
    return;
  }

  // Separar eventos all-day de los que tienen hora
  var todoElDia = [];
  var conHora = [];
  for (var i = 0; i < eventosDia.length; i++) {
    var ev = eventosDia[i];
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
    (fechaRef.getDate() + '/' + (fechaRef.getMonth() + 1) + '/' + fechaRef.getFullYear()) +
    (FECHA_BUSCAR_CAL ? '' : ' (hoy)') +
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

// ============ EXPORTACIÓN A PDF ============
var PDF_VISTA = 'dia';
var PDF_DOC = null;
var PDF_BLOB_URL = null;
var PDF_MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
var PDF_DIAS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
var PDF_DIAS_CORTO = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
var PDF_INI_DIA = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
var PDF_TIPOS_ORDEN = ['sala', 'reuniones', 'capacitaciones', 'cumpleanos', 'audiencias', 'compromisos', 'viajes', 'feriados', 'otros'];

function pdfRgb(hex) {
  var h = hex.replace('#', '');
  return [parseInt(h.substring(0, 2), 16), parseInt(h.substring(2, 4), 16), parseInt(h.substring(4, 6), 16)];
}

function pdfClave(f) {
  return f.getFullYear() + '-' + pad2(f.getMonth() + 1) + '-' + pad2(f.getDate());
}

function pdfFechaLarga(f) {
  return PDF_DIAS[f.getDay()] + ' ' + f.getDate() + ' de ' + PDF_MESES[f.getMonth()] + ' de ' + f.getFullYear();
}

function pdfFechaCorta(f) {
  return f.getDate() + '/' + (f.getMonth() + 1) + '/' + f.getFullYear();
}

function pdfBase() {
  var b = FECHA_BUSCAR_CAL ? new Date(FECHA_BUSCAR_CAL.getTime()) : new Date();
  return new Date(b.getFullYear(), b.getMonth(), b.getDate());
}

function pdfInicioSemana(f) {
  var d = new Date(f.getFullYear(), f.getMonth(), f.getDate());
  var dow = d.getDay();
  d.setDate(d.getDate() + (dow === 0 ? -6 : 1 - dow));
  return d;
}

function pdfRangoVista() {
  var b = pdfBase();
  if (PDF_VISTA === 'dia') {
    return { desde: b, hasta: new Date(b.getTime()) };
  }
  if (PDF_VISTA === 'semana') {
    var d = pdfInicioSemana(b);
    var u = new Date(d.getTime());
    u.setDate(u.getDate() + 6);
    return { desde: d, hasta: u };
  }
  if (PDF_VISTA === 'mes') {
    return { desde: new Date(b.getFullYear(), b.getMonth(), 1), hasta: new Date(b.getFullYear(), b.getMonth() + 1, 0) };
  }
  return { desde: new Date(b.getFullYear(), 0, 1), hasta: new Date(b.getFullYear(), 11, 31) };
}

function pdfEtiquetaVista() {
  var r = pdfRangoVista();
  if (PDF_VISTA === 'dia') return pdfFechaLarga(r.desde);
  if (PDF_VISTA === 'semana') return 'Semana del ' + pdfFechaCorta(r.desde) + ' al ' + pdfFechaCorta(r.hasta);
  if (PDF_VISTA === 'mes') return PDF_MESES[r.desde.getMonth()] + ' ' + r.desde.getFullYear();
  return 'Año ' + r.desde.getFullYear();
}

function pdfEventosRango(desde, hasta) {
  var lista = todosLosEventos.filter(function(ev) {
    if (clasificarEvento(ev) === 'cumpleanos') return false;  // los cumpleaños no se exportan
    var f = parsearFecha(ev.inicio);
    if (f.getTime() < desde.getTime() || f.getTime() > hasta.getTime()) return false;
    if (FILTRO_TIPO && clasificarEvento(ev) !== FILTRO_TIPO) return false;
    if (TEXTO_BUSQUEDA) {
      var busq = TEXTO_BUSQUEDA.toLowerCase();
      var info = ((ev.titulo || '') + ' ' + (ev.descripcion || '') + ' ' + (ev.ubicacion || '')).toLowerCase();
      if (info.indexOf(busq) === -1) return false;
    }
    return true;
  });
  lista.sort(function(a, b) { return a.inicio.localeCompare(b.inicio); });
  return lista;
}

function pdfMapaDias(lista) {
  var mapa = {};
  for (var i = 0; i < lista.length; i++) {
    var k = formatearFechaInput(lista[i].inicio);
    if (!mapa[k]) mapa[k] = [];
    mapa[k].push(lista[i]);
  }
  return mapa;
}

function pdfFiltrosTexto(n) {
  var partes = [];
  if (FILTRO_TIPO) partes.push('Tipo: ' + asignarColor(FILTRO_TIPO).texto);
  if (TEXTO_BUSQUEDA) partes.push('Búsqueda: "' + TEXTO_BUSQUEDA + '"');
  if (typeof n === 'number') partes.push(n + ' evento' + (n === 1 ? '' : 's'));
  if (!partes.length) partes.push('Sin filtros activos');
  return partes.join('   |   ');
}

function pdfCortar(doc, texto, maxMm) {
  texto = String(texto == null ? '' : texto);
  if (!texto) return '';
  if (doc.getTextWidth(texto) <= maxMm) return texto;
  var t = texto;
  while (t.length > 1 && doc.getTextWidth(t + '...') > maxMm) t = t.slice(0, -1);
  return t + '...';
}

// Devuelve el texto partido en líneas que entran en el ancho dado (máx. maxLineas).
// Si no entra completo, la última línea se corta con puntos.
function pdfAjustar(doc, texto, ancho, maxLineas) {
  var l = doc.splitTextToSize(String(texto == null ? '' : texto), ancho);
  if (typeof l === 'string') l = [l];
  if (l.length <= maxLineas) return l;
  l = l.slice(0, maxLineas);
  l[maxLineas - 1] = pdfCortar(doc, l[maxLineas - 1] + '...', ancho);
  return l;
}

// En las grillas compactas (Mes/Semana) se elimina el prefijo repetido
// "Sala de Situación DTRA - ..." porque el color ya indica el tipo.
function pdfTituloCorto(titulo) {
  var t = String(titulo == null ? '' : titulo);
  var baja = t.toLowerCase();
  var prefijos = ['sala de situación dtra -', 'sala de situacion dtra -', 'sala dtra -',
                  'sala de situación -', 'sala de situacion -'];
  for (var i = 0; i < prefijos.length; i++) {
    var p = prefijos[i];
    if (baja.indexOf(p) === 0) {
      var resto = t.substring(p.length).replace(/^[\s:.\-–—]+/, '');
      if (resto.length > 3) return resto;
    }
  }
  return t;
}

function pdfCabecera(doc, titulo, subtitulo) {
  doc.setFillColor(238, 240, 255);
  doc.rect(0, 0, 210, 30, 'F');
  doc.setFillColor(79, 70, 229);
  doc.rect(0, 30, 210, 1.2, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.setTextColor(30, 27, 75);
  doc.text(pdfCortar(doc, 'CALENDARIO GENERAL - SALA DE SITUACIÓN DTRA', 190), 10, 13.5);
  doc.setFontSize(10);
  doc.setTextColor(79, 70, 229);
  doc.text(pdfCortar(doc, titulo, 190), 10, 20.5);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(100, 104, 135);
  doc.text(pdfCortar(doc, subtitulo, 190), 10, 25.5);
}

function pdfPie(doc) {
  var total = doc.internal.getNumberOfPages();
  var h = new Date();
  var fecha = pdfFechaCorta(h) + ' ' + pad2(h.getHours()) + ':' + pad2(h.getMinutes());
  for (var i = 1; i <= total; i++) {
    doc.setPage(i);
    doc.setDrawColor(226, 226, 238);
    doc.line(10, 287, 200, 287);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(130, 134, 160);
    doc.text('Generado: ' + fecha + ' - Sala de Situación DTRA', 10, 291.5);
    doc.text('Página ' + i + ' de ' + total, 200, 291.5, { align: 'right' });
  }
}

function pdfTarjetaEvento(doc, ev, x, y, ancho) {
  var tipo = clasificarEvento(ev);
  var color = asignarColor(tipo);
  var rgb = pdfRgb(color.fondo);
  // Título: hasta 2 líneas con salto de línea (no se corta si entra)
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  var tit = pdfAjustar(doc, ev.titulo || 'Sin título', ancho - 14, 2);
  // Descripción/ubicación: hasta 3 líneas
  var lineasExtra = [];
  if (ev.ubicacion) lineasExtra.push('Ubicación: ' + ev.ubicacion);
  if (ev.descripcion) {
    var dl = doc.splitTextToSize(ev.descripcion, ancho - 26);
    if (typeof dl === 'string') dl = [dl];
    var trunco = dl.length > 3;
    if (trunco) dl = dl.slice(0, 3);
    for (var i = 0; i < dl.length; i++) lineasExtra.push(dl[i] + (trunco && i === dl.length - 1 ? ' ...' : ''));
  }
  // Altura según líneas reales
  var yExt = 13 + tit.length * 5;
  var ultima = lineasExtra.length ? (yExt + (lineasExtra.length - 1) * 4.5) : (13 + (tit.length - 1) * 5);
  var alto = ultima + 4;
  doc.setDrawColor(226, 226, 238);
  doc.setFillColor(250, 250, 254);
  doc.roundedRect(x, y, ancho, alto, 2.5, 2.5, 'FD');
  doc.setFillColor(rgb[0], rgb[1], rgb[2]);
  doc.roundedRect(x, y, 5, alto, 2.5, 2.5, 'F');
  doc.rect(x + 2.5, y, 2.5, alto, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(rgb[0], rgb[1], rgb[2]);
  var hora = formatearHora(ev.inicio);
  var horaFin = formatearHora(ev.fin);
  var txtHora = (ev.todoElDia || !hora) ? 'Todo el día' : (hora + (horaFin ? ' a ' + horaFin : ''));
  doc.text(txtHora, x + 8, y + 6.5);
  doc.setFontSize(7.5);
  var bw = doc.getTextWidth(color.texto) + 5;
  doc.setFillColor(rgb[0], rgb[1], rgb[2]);
  doc.roundedRect(x + ancho - bw - 4, y + 2.6, bw, 5, 2, 2, 'F');
  doc.setTextColor(255, 255, 255);
  doc.text(color.texto, x + ancho - bw - 1.5, y + 6.4);
  doc.setFontSize(11);
  doc.setTextColor(30, 27, 75);
  for (var t = 0; t < tit.length; t++) doc.text(tit[t], x + 8, y + 13 + t * 5);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(100, 104, 125);
  for (var j = 0; j < lineasExtra.length; j++) {
    doc.text(lineasExtra[j], x + 8, y + yExt + j * 4.5);
  }
  return y + alto + 4;
}

function pdfLeyenda(doc, y, lista) {
  if (!document.getElementById('pdf-leyenda').checked) return;
  var vistos = [];
  for (var i = 0; i < lista.length; i++) {
    var t = clasificarEvento(lista[i]);
    if (vistos.indexOf(t) === -1) vistos.push(t);
  }
  if (!vistos.length) return;
  doc.setDrawColor(226, 226, 238);
  doc.line(10, y - 5, 200, y - 5);
  var x = 10;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(90, 94, 120);
  doc.text('Leyenda:', x, y);
  x += 17;
  doc.setFont('helvetica', 'normal');
  for (var j = 0; j < PDF_TIPOS_ORDEN.length; j++) {
    var tipo = PDF_TIPOS_ORDEN[j];
    if (vistos.indexOf(tipo) === -1) continue;
    var color = asignarColor(tipo);
    var rgb = pdfRgb(color.fondo);
    var w = doc.getTextWidth(color.texto) + 9;
    if (x + w > 200) { x = 10; y += 5.5; }
    doc.setFillColor(rgb[0], rgb[1], rgb[2]);
    doc.roundedRect(x, y - 3.4, 3.6, 3.6, 0.9, 0.9, 'F');
    doc.setTextColor(74, 78, 105);
    doc.text(color.texto, x + 5, y);
    x += w;
  }
}

function pdfVistaDia(doc) {
  var r = pdfRangoVista();
  var lista = pdfEventosRango(r.desde, r.hasta);
  var conLey = document.getElementById('pdf-leyenda').checked && lista.length > 0;
  pdfCabecera(doc, pdfFechaLarga(r.desde), pdfFiltrosTexto(lista.length));
  var y = 40;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(30, 27, 75);
  doc.text('Eventos del día', 10, y);
  y += 7;
  if (!lista.length) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(110, 114, 135);
    doc.text('No hay eventos para este día con los filtros aplicados.', 10, y);
    return;
  }
  for (var i = 0; i < lista.length; i++) {
    if (y > 268) {
      doc.addPage();
      pdfCabecera(doc, pdfFechaLarga(r.desde) + ' (continuación)', pdfFiltrosTexto(lista.length));
      y = 40;
    }
    y = pdfTarjetaEvento(doc, lista[i], 10, y, 190);
  }
  if (conLey && y + 10 < 280) pdfLeyenda(doc, y + 9, lista);
}

function pdfVistaSemana(doc) {
  var r = pdfRangoVista();
  var lista = pdfEventosRango(r.desde, r.hasta);
  var mapa = pdfMapaDias(lista);
  var conLey = document.getElementById('pdf-leyenda').checked && lista.length > 0;
  pdfCabecera(doc, 'Semana del ' + pdfFechaCorta(r.desde) + ' al ' + pdfFechaCorta(r.hasta), pdfFiltrosTexto(lista.length));
  var x0 = 10, anchoCol = 190 / 7, yHdr = 38, altoHdr = 10, yCuerpo = 50;
  var pieCuerpo = conLey ? 266 : 281;
  var hoyClave = pdfClave(new Date());
  for (var c = 0; c < 7; c++) {
    var f = new Date(r.desde.getFullYear(), r.desde.getMonth(), r.desde.getDate() + c);
    var x = x0 + c * anchoCol;
    var esFinde = c >= 5;
    var esHoyCol = pdfClave(f) === hoyClave;
    var evs = mapa[pdfClave(f)] || [];
    var rgbHdr = esHoyCol ? [245, 158, 11] : (esFinde ? [100, 105, 140] : [79, 70, 229]);
    doc.setFillColor(rgbHdr[0], rgbHdr[1], rgbHdr[2]);
    doc.rect(x, yHdr, anchoCol, altoHdr, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(255, 255, 255);
    doc.text(PDF_DIAS_CORTO[c], x + anchoCol / 2, yHdr + 4.5, { align: 'center' });
    doc.setFontSize(7);
    var etFecha = f.getDate() + '/' + (f.getMonth() + 1) + (evs.length ? ' (' + evs.length + ')' : '');
    doc.text(etFecha, x + anchoCol / 2, yHdr + 8.5, { align: 'center' });
    doc.setDrawColor(226, 226, 238);
    if (esFinde) doc.setFillColor(247, 247, 251); else doc.setFillColor(255, 255, 255);
    doc.rect(x, yCuerpo, anchoCol, pieCuerpo - yCuerpo, 'FD');
    var yE = yCuerpo + 2;
    var dibujados = 0;
    for (var i = 0; i < evs.length; i++) {
      var ev = evs[i];
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(6.5);
      var tit = pdfAjustar(doc, pdfTituloCorto(ev.titulo || 'Sin título'), anchoCol - 5, 4);
      var bloqueAlto = 7.5 + tit.length * 3.4;
      if (yE + bloqueAlto > pieCuerpo - 2) break;
      var rgb = pdfRgb(asignarColor(clasificarEvento(ev)).fondo);
      doc.setFillColor(rgb[0], rgb[1], rgb[2]);
      doc.roundedRect(x + 1.5, yE, anchoCol - 3, bloqueAlto, 1.5, 1.5, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(6.5);
      doc.setTextColor(255, 255, 255);
      var hora = ev.todoElDia ? 'Todo el día' : (formatearHora(ev.inicio) || 'Todo el día');
      doc.text(pdfCortar(doc, hora, anchoCol - 5), x + 3, yE + 4.3);
      for (var t2 = 0; t2 < tit.length; t2++) doc.text(tit[t2], x + 3, yE + 8.0 + t2 * 3.4);
      yE += bloqueAlto + 1.3;
      dibujados++;
    }
    if (evs.length > dibujados) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(6.5);
      doc.setTextColor(79, 70, 229);
      doc.text('+' + (evs.length - dibujados) + ' más', x + 3, Math.min(yE + 4, pieCuerpo - 2));
    } else if (!evs.length) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7);
      doc.setTextColor(180, 184, 205);
      doc.text('—', x + anchoCol / 2, yCuerpo + 8, { align: 'center' });
    }
  }
  if (conLey) pdfLeyenda(doc, 274, lista);
}

function pdfVistaMes(doc) {
  var r = pdfRangoVista();
  var lista = pdfEventosRango(r.desde, r.hasta);
  var mapa = pdfMapaDias(lista);
  var mes = r.desde.getMonth(), anio = r.desde.getFullYear();
  var conLey = document.getElementById('pdf-leyenda').checked && lista.length > 0;
  pdfCabecera(doc, PDF_MESES[mes] + ' ' + anio, pdfFiltrosTexto(lista.length));
  var x0 = 10, anchoCol = 190 / 7, yHdr = 37, altoHdr = 6;
  for (var c = 0; c < 7; c++) {
    var x = x0 + c * anchoCol;
    doc.setFillColor(79, 70, 229);
    doc.rect(x, yHdr, anchoCol, altoHdr, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(255, 255, 255);
    doc.text(PDF_DIAS_CORTO[c], x + anchoCol / 2, yHdr + 4.3, { align: 'center' });
  }
  var leading = (r.desde.getDay() + 6) % 7;
  var dias = r.hasta.getDate();
  var filas = Math.ceil((leading + dias) / 7);
  var yGrid = yHdr + altoHdr + 2;
  var altoCelda = (272 - yGrid) / filas;
  var hoy = new Date();
  for (var d = 1; d <= dias; d++) {
    var idx = leading + d - 1;
    var fila = Math.floor(idx / 7), col = idx % 7;
    var xc = x0 + col * anchoCol, yc = yGrid + fila * altoCelda;
    var esHoyCelda = d === hoy.getDate() && mes === hoy.getMonth() && anio === hoy.getFullYear();
    var finde = col >= 5;
    doc.setDrawColor(226, 226, 238);
    if (esHoyCelda) doc.setFillColor(255, 244, 214);
    else if (finde) doc.setFillColor(247, 247, 251);
    else doc.setFillColor(255, 255, 255);
    doc.rect(xc, yc, anchoCol, altoCelda, 'FD');
    if (esHoyCelda) {
      doc.setFillColor(79, 70, 229);
      doc.roundedRect(xc + 1.2, yc + 1.2, 7, 5.4, 1.5, 1.5, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      doc.setTextColor(255, 255, 255);
      doc.text('' + d, xc + 4.7, yc + 5.1, { align: 'center' });
    } else {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      doc.setTextColor(30, 27, 75);
      doc.text('' + d, xc + 2, yc + 5.5);
    }
    var evs = mapa[pdfClave(new Date(anio, mes, d))] || [];
    var yE = yc + 7.5;
    var tope = yc + altoCelda - 1.5;
    var dib = 0;
    for (var i = 0; i < evs.length; i++) {
      var ev = evs[i];
      var hora = ev.todoElDia ? '' : formatearHora(ev.inicio);
      var linea = (hora ? hora + ' ' : '') + pdfTituloCorto(ev.titulo || 'Sin título');
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(6.5);
      var maxLineas = Math.max(1, Math.floor(((tope - yE) - 0.8) / 4.2));
      var full = doc.splitTextToSize(linea, anchoCol - 6.4);
      if (typeof full === 'string') full = [full];
      var sub;
      if (full.length > maxLineas) {
        // No entra completo en el espacio que queda:
        if (dib > 0) break;  // no el primero → se muestra "+N" y se corta acá
        sub = pdfAjustar(doc, linea, anchoCol - 6.4, maxLineas);  // primero → se corta sólo si es gigante
      } else {
        sub = full;
      }
      var hBloque = sub.length * 4.2 + 0.8;
      var rgb = pdfRgb(asignarColor(clasificarEvento(ev)).fondo);
      doc.setFillColor(rgb[0], rgb[1], rgb[2]);
      doc.rect(xc + 1.2, yE, 2.4, sub.length * 4.2 - 0.8, 'F');
      doc.setTextColor(60, 64, 92);
      for (var s = 0; s < sub.length; s++) doc.text(sub[s], xc + 4.4, yE + 3.1 + s * 4.2);
      yE += hBloque;
      dib++;
    }
    if (evs.length > dib) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(6.5);
      doc.setTextColor(79, 70, 229);
      doc.text('+' + (evs.length - dib), xc + anchoCol - 2, yc + 5.5, { align: 'right' });
    }
  }
  if (conLey) pdfLeyenda(doc, 279, lista);
}

function pdfVistaAnio(doc) {
  var r = pdfRangoVista();
  var anio = r.desde.getFullYear();
  var lista = pdfEventosRango(r.desde, r.hasta);
  var mapa = pdfMapaDias(lista);
  var conLey = document.getElementById('pdf-leyenda').checked && lista.length > 0;
  pdfCabecera(doc, 'Año ' + anio, pdfFiltrosTexto(lista.length));
  var anchoCaja = 190 / 3, altoCaja = 55, y0 = 37;
  for (var m = 0; m < 12; m++) {
    var col = m % 3, fila = Math.floor(m / 3);
    var x = 10 + col * anchoCaja, y = y0 + fila * (altoCaja + 3);
    var w = anchoCaja - 3;
    doc.setDrawColor(226, 226, 238);
    doc.setFillColor(255, 255, 255);
    doc.roundedRect(x, y, w, altoCaja, 2, 2, 'FD');
    doc.setFillColor(79, 70, 229);
    doc.roundedRect(x, y, w, 6.5, 2, 2, 'F');
    doc.rect(x, y + 3.5, w, 3, 'F');
    var nMes = 0;
    for (var k = 0; k < lista.length; k++) {
      var fm = parsearFecha(lista[k].inicio);
      if (fm.getMonth() === m && fm.getFullYear() === anio) nMes++;
    }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(255, 255, 255);
    doc.text(pdfCortar(doc, PDF_MESES[m] + ' (' + nMes + ')', w - 6), x + 3, y + 4.7);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6);
    doc.setTextColor(120, 124, 150);
    var colW = (w - 6) / 7;
    var xD = x + 3;
    for (var c = 0; c < 7; c++) doc.text(PDF_INI_DIA[c], xD + c * colW + colW / 2, y + 11.5, { align: 'center' });
    var primero = new Date(anio, m, 1);
    var leading = (primero.getDay() + 6) % 7;
    var dias = new Date(anio, m + 1, 0).getDate();
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.5);
    for (var d = 1; d <= dias; d++) {
      var idx = leading + d - 1;
      var cc = idx % 7, rr = Math.floor(idx / 7);
      var dx = xD + cc * colW, dy = y + 13 + rr * 6;
      var evs = mapa[pdfClave(new Date(anio, m, d))];
      if (evs && evs.length) {
        var rgb = pdfRgb(asignarColor(clasificarEvento(evs[0])).fondo);
        doc.setFillColor(rgb[0], rgb[1], rgb[2]);
        doc.roundedRect(dx, dy, colW - 0.8, 5.2, 1, 1, 'F');
        doc.setTextColor(255, 255, 255);
      } else {
        doc.setTextColor(74, 78, 105);
      }
      doc.text('' + d, dx + (colW - 0.8) / 2, dy + 3.8, { align: 'center' });
    }
  }
  if (conLey) pdfLeyenda(doc, 275, lista);
}

function construirPDF() {
  if (typeof jspdf === 'undefined' || !jspdf.jsPDF) {
    throw new Error('No se cargó la librería jsPDF (verificá la conexión a internet).');
  }
  var doc = new jspdf.jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  if (PDF_VISTA === 'dia') pdfVistaDia(doc);
  else if (PDF_VISTA === 'semana') pdfVistaSemana(doc);
  else if (PDF_VISTA === 'mes') pdfVistaMes(doc);
  else pdfVistaAnio(doc);
  pdfPie(doc);
  return doc;
}

function abrirModalPDF() {
  var v = 'dia';
  if (!FECHA_BUSCAR_CAL) {
    if (FILTRO_PERIODO === 'semana') v = 'semana';
    else if (FILTRO_PERIODO === 'mes') v = 'mes';
    else if (FILTRO_PERIODO === 'anio') v = 'anio';
  }
  PDF_VISTA = v;
  document.querySelectorAll('.pdf-vista-btn').forEach(function(b) {
    b.classList.toggle('active', b.getAttribute('data-vista') === v);
  });
  pdfReconstruir();
  var m = new bootstrap.Modal(document.getElementById('modalExportPdf'));
  m.show();
}

function pdfCambiarVista(v) {
  PDF_VISTA = v;
  document.querySelectorAll('.pdf-vista-btn').forEach(function(b) {
    b.classList.toggle('active', b.getAttribute('data-vista') === v);
  });
  pdfReconstruir();
}

function pdfReconstruir() {
  var info = document.getElementById('pdf-info');
  var btn = document.getElementById('pdf-btn-descargar');
  try {
    PDF_DOC = construirPDF();
    var blob = PDF_DOC.output('blob');
    if (PDF_BLOB_URL) URL.revokeObjectURL(PDF_BLOB_URL);
    PDF_BLOB_URL = URL.createObjectURL(blob);
    document.getElementById('pdf-preview').src = PDF_BLOB_URL;
    btn.disabled = false;
    info.className = 'pdf-info mb-2';
    var pags = PDF_DOC.internal.getNumberOfPages();
    info.textContent = 'Vista: ' + pdfEtiquetaVista() + ' · ' + pags + ' página' + (pags === 1 ? '' : 's') +
      ' · Respeta los filtros activos de la pantalla.';
  } catch (e) {
    PDF_DOC = null;
    btn.disabled = true;
    info.className = 'pdf-info mb-2 error';
    info.textContent = 'No se pudo generar el PDF: ' + (e && e.message ? e.message : e);
  }
}

function pdfDescargar() {
  if (!PDF_DOC) return;
  var h = new Date();
  PDF_DOC.save('Calendario_' + PDF_VISTA + '_' + h.getFullYear() + pad2(h.getMonth() + 1) + pad2(h.getDate()) + '.pdf');
}
