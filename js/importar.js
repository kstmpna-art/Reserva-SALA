// ============================================================
// IMPORTACIÓN DE ARCHIVOS AL CALENDARIO - parsers puros (sin DOM)
// Formatos: .xlsx (aniversarios), .pdf y .doc/.docx (listas de personas)
// El .txt lo sigue procesando calendario.js (parsearAgendaTxt).
// ============================================================
(function (global) {
  'use strict';

  var MESES_TXT = ['ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO',
    'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE'];

  // ---------------- utilidades ----------------

  function aLatin1(buf) {
    // Byte-fiel en todos los navegadores: NO usar TextDecoder('windows-1252')
    // porque en Chrome mapea 0x80-0x9F a € ‚ " – (U+20AC...) y
    // u8DesdeLatin1 (charCodeAt & 0xFF) corrompería los bytes comprimidos
    // de los PDF/ZIP. String.fromCharCode(byte) conserva el byte exacto.
    var u8 = (buf instanceof Uint8Array) ? buf : new Uint8Array(buf);
    var s = '', paso = 8192;
    for (var i = 0; i < u8.length; i += paso) {
      s += String.fromCharCode.apply(null, u8.subarray(i, Math.min(i + paso, u8.length)));
    }
    return s;
  }

  function aUtf8(buf) {
    var u8 = (buf instanceof Uint8Array) ? buf : new Uint8Array(buf);
    return new TextDecoder('utf-8').decode(u8);
  }

  function u8DesdeLatin1(str) {
    var b = new Uint8Array(str.length);
    for (var i = 0; i < str.length; i++) b[i] = str.charCodeAt(i) & 0xFF;
    return b;
  }

  function quitarAcentos(s) {
    s = String(s || '');
    return s.normalize ? s.normalize('NFD').replace(/[\u0300-\u036f]/g, '') : s;
  }

  // Clave "sin espacios" para comparar: 'de bora' -> 'debora'
  function claveTexto(s) {
    return quitarAcentos(String(s || '').toLowerCase()).replace(/[^a-z0-9]+/g, '');
  }

  var STOPWORDS = { de: 1, del: 1, la: 1, el: 1, los: 1, las: 1, y: 1, o: 1, a: 1, en: 1, con: 1, por: 1, para: 1, un: 1, una: 1, sra: 1, sr: 1, annora: 1, anora: 1, senora: 1, senor: 1, señor: 1 };

  function tokensTexto(s) {
    var t = quitarAcentos(String(s || '').toLowerCase()).replace(/[^a-z0-9]+/g, ' ').trim();
    var out = [], partes = t.split(' ');
    for (var i = 0; i < partes.length; i++) {
      if (partes[i].length >= 3 && !STOPWORDS[partes[i]]) out.push(partes[i]);
    }
    return out;
  }

  // ¿Decir "a" describe a la misma persona/cosa que "b"?
  // 1) clave sin espacios idéntica o una contiene a la otra (>=6 chars)
  // 2) o los tokens del más corto están todos dentro del más largo
  function nombresCoinciden(a, b) {
    var ka = claveTexto(a), kb = claveTexto(b);
    if (!ka || !kb) return false;
    if (ka === kb) return true;
    var chico = ka.length <= kb.length ? ka : kb;
    var grande = ka.length <= kb.length ? kb : ka;
    if (chico.length >= 6 && grande.indexOf(chico) !== -1) return true;
    var ta = tokensTexto(a), tb = tokensTexto(b);
    if (!ta.length || !tb.length) return false;
    var chica = ta.length <= tb.length ? ta : tb;
    var grandeT = ta.length <= tb.length ? tb : ta;
    var setGrande = {};
    for (var i = 0; i < grandeT.length; i++) setGrande[grandeT[i]] = true;
    var subs = true, signif = false;
    for (var j = 0; j < chica.length; j++) {
      if (!setGrande[chica[j]]) { subs = false; break; }
      if (chica[j].length >= 4) signif = true;
    }
    return subs && signif;
  }

  // tipo legible en un título: 'cumpleanos' | 'bodas' | 'aniversario' | ''
  function tipoDeTitulo(t) {
    var s = quitarAcentos(String(t || '').toLowerCase());
    if (s.indexOf('cumplea') !== -1) return 'cumpleanos';
    if (s.indexOf('boda') !== -1) return 'bodas';
    if (s.indexOf('aniversario') !== -1) return 'aniversario';
    return '';
  }

  function tiposCompatibles(t1, t2) {
    if (!t1 || !t2) return true;
    return t1 === t2;
  }

  // ---------------- ZIP (para .xlsx y .docx) ----------------

  async function inflar(bytes, formato) {
    var ds = new DecompressionStream(formato);
    var stream = new Blob([bytes]).stream().pipeThrough(ds);
    var ab = await new Response(stream).arrayBuffer();
    return new Uint8Array(ab);
  }

  async function inflarZip(bytes) {
    var cortes = [0, -1, -2];
    var formatos = ['deflate-raw', 'deflate'];
    for (var f = 0; f < formatos.length; f++) {
      for (var c = 0; c < cortes.length; c++) {
        var fin = cortes[c] === 0 ? bytes.length : bytes.length + cortes[c];
        if (fin <= 0) continue;
        try {
          var out = await inflar(bytes.subarray(0, fin), formatos[f]);
          if (out.length) return out;
        } catch (e) { /* probar siguiente */ }
      }
    }
    return null;
  }

  function verDword(dv, off) { return dv.getUint32(off, true); }

  // Devuelve { nombre: Uint8Array }
  async function leerZip(arrayBuffer) {
    var u8 = new Uint8Array(arrayBuffer);
    var dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    // buscar EOCD (0x06054b50) desde el final (hasta 64KB antes)
    var eocd = -1;
    var limite = Math.max(0, u8.length - 65557);
    for (var i = u8.length - 22; i >= limite; i--) {
      if (verDword(dv, i) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('ZIP inválido (sin EOCD)');
    var cant = dv.getUint16(eocd + 10, true);
    var offCentral = verDword(dv, eocd + 16);
    var archivos = {};
    var p = offCentral;
    for (var n = 0; n < cant; n++) {
      if (verDword(dv, p) !== 0x02014b50) break;
      var metodo = dv.getUint16(p + 10, true);
      var compSize = verDword(dv, p + 20);
      var nombreLen = dv.getUint16(p + 28, true);
      var extraLen = dv.getUint16(p + 30, true);
      var comLen = dv.getUint16(p + 32, true);
      var localOff = verDword(dv, p + 42);
      var nombre = aLatin1(u8.subarray(p + 46, p + 46 + nombreLen));
      // header local
      if (verDword(dv, localOff) !== 0x04034b50) { p += 46 + nombreLen + extraLen + comLen; continue; }
      var lNombreLen = dv.getUint16(localOff + 26, true);
      var lExtraLen = dv.getUint16(localOff + 28, true);
      var dataOff = localOff + 30 + lNombreLen + lExtraLen;
      var datos = u8.subarray(dataOff, dataOff + compSize);
      if (metodo === 0) {
        archivos[nombre] = datos;
      } else if (metodo === 8) {
        archivos[nombre] = await inflarZip(datos);
      }
      p += 46 + nombreLen + extraLen + comLen;
    }
    return archivos;
  }

  // ---------------- XLSX ----------------

  function decXml(s) {
    return String(s || '')
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
      .replace(/&amp;/g, '&');
  }

  function colANum(col) {
    var n = 0;
    for (var i = 0; i < col.length; i++) n = n * 26 + (col.charCodeAt(i) - 64);
    return n;
  }

  function parsearSharedStrings(xml) {
    var out = [];
    var reSi = /<si>([\s\S]*?)<\/si>/g, m;
    while ((m = reSi.exec(xml)) !== null) {
      var partes = m[1].match(/<t[^>]*>([\s\S]*?)<\/t>/g) || [];
      var txt = '';
      for (var i = 0; i < partes.length; i++) txt += decXml(partes[i].replace(/<[^>]+>/g, ''));
      out.push(txt);
    }
    return out;
  }

  function parsearCeldas(sheetXml, strings) {
    // normalizar celdas auto-cerradas: <c ... /> rompe el regex si no se expanden
    sheetXml = sheetXml.replace(/<c\s+([^>]*?)\/>/g, '<c $1></c>');
    var filas = {};
    var reC = /<c r="([A-Z]+)(\d+)"([^>]*)>([\s\S]*?)<\/c>/g, m;
    while ((m = reC.exec(sheetXml)) !== null) {
      var col = m[1], fila = parseInt(m[2], 10), attrs = m[3], cuerpo = m[4];
      var vM = cuerpo.match(/<v>([\s\S]*?)<\/v>/);
      if (!vM) continue;
      var v = vM[1];
      if (attrs.indexOf('t="s"') !== -1) {
        var idx = parseInt(v, 10);
        v = (strings[idx] !== undefined) ? strings[idx] : '';
      } else if (attrs.indexOf('t="str"') !== -1 || attrs.indexOf('t="inlineStr"') !== -1) {
        v = decXml(v);
      } else {
        v = v.replace(/^[\s]*|[\s]*$/g, '');
      }
      if (!filas[fila]) filas[fila] = {};
      filas[fila][col] = v;
    }
    return filas;
  }

  // Devuelve registros { dd, mm, anio, tipo:'aniversario', nombre }
  async function importarXLSX(arrayBuffer) {
    var zip = await leerZip(arrayBuffer);
    var stringsXml = zip['xl/sharedStrings.xml'];
    var strings = stringsXml ? parsearSharedStrings(aUtf8(stringsXml)) : [];

    // orden de hojas y nombre de mes por pestaña
    var hojas = [];
    var wb = zip['xl/workbook.xml'];
    if (wb) {
      var reHoja = /<sheet[^>]*name="([^"]*)"[^>]*r:id="([^"]*)"/g, mh;
      var reHoja2 = /<sheet[^>]*r:id="([^"]*)"[^>]*name="([^"]*)"/g;
      var textoWb = aUtf8(wb);
      while ((mh = reHoja.exec(textoWb)) !== null) hojas.push({ nombre: decXml(mh[1]), rid: mh[2] });
      if (!hojas.length) {
        while ((mh = reHoja2.exec(textoWb)) !== null) hojas.push({ nombre: decXml(mh[2]), rid: mh[1] });
      }
    }
    var targets = {};
    var rels = zip['xl/_rels/workbook.xml.rels'];
    if (rels) {
      var reRel = /<Relationship[^>]*Id="([^"]*)"[^>]*Target="([^"]*)"/g, mr;
      var textoRels = aUtf8(rels);
      while ((mr = reRel.exec(textoRels)) !== null) targets[mr[1]] = mr[2];
      reRel = /<Relationship[^>]*Target="([^"]*)"[^>]*Id="([^"]*)"/g;
      while ((mr = reRel.exec(textoRels)) !== null) targets[mr[2]] = mr[1];
    }

    // si no hay workbook, usar sheet1..sheetN directamente
    var nombresHojas = [];
    for (var i = 0; i < hojas.length; i++) {
      var t = targets[hojas[i].rid] || '';
      t = t.replace(/^\//, '').replace(/^xl\//, '');
      nombresHojas.push({ mes: mesDeNombreMes(hojas[i].nombre), archivo: 'xl/' + t.replace(/^xl\//, '') });
    }
    if (!nombresHojas.length) {
      for (var s = 1; s <= 12; s++) nombresHojas.push({ mes: s, archivo: 'xl/worksheets/sheet' + s + '.xml' });
    }

    var registros = [], avisos = [];
    for (var h = 0; h < nombresHojas.length; h++) {
      var entry = zip[nombresHojas[h].archivo];
      if (!entry) {
        // intentar variantes de ruta
        var clave = Object.keys(zip).filter(function (k) {
          return k.indexOf('worksheets/sheet') !== -1 && k === nombresHojas[h].archivo.replace(/^xl\//, '');
        })[0];
        if (clave) entry = zip[clave];
      }
      if (!entry) continue;
      var filas = parsearCeldas(aUtf8(entry), strings);
      var depActual = '';
      var porHoja = 0;
      for (var fIdx in filas) {
        var fila = filas[fIdx];
        var bTxt = fila.B ? String(fila.B).trim() : '';
        var esBasura = /INDICAR|EN CURSO|AÑO EN/i.test(bTxt);
        // B = dependencia (se arrastra hacia abajo), C = día, D = mes, E = año
        if (bTxt && !esBasura && /[A-Za-zÁÉÍÓÚÑáéíóúñ]/.test(bTxt) && bTxt.length > 3) {
          depActual = bTxt;
        }
        var dd = parseInt(fila.C, 10);
        var mm = parseInt(fila.D, 10);
        var anio = parseInt(fila.E, 10);
        if (isNaN(dd) || isNaN(mm)) continue;
        if (esBasura) continue;
        // por si las columnas vinieran rotadas (algunas hojas): si D no es mes válido...
        if (mm < 1 || mm > 12) {
          if (nombresHojas[h].mes && dd >= 1 && dd <= 31 && !isNaN(anio)) mm = nombresHojas[h].mes;
          else continue;
        }
        if (dd < 1 || dd > 31) continue;
        if (isNaN(anio) || anio < 1500 || anio > 2100) continue;
        if (!depActual) { avisos.push('Fila ' + fIdx + ' sin dependencia (hoja ' + h + ')'); continue; }
        registros.push({ dd: dd, mm: mm, anio: anio, tipo: 'aniversario', nombre: depActual, archivo: '' });
        porHoja++;
      }
      if (!porHoja) avisos.push('Hoja ' + (nombresHojas[h].archivo) + ' sin registros');
    }
    return { registros: registros, avisos: avisos };
  }

  function mesDeNombreMes(nombre) {
    var n = quitarAcentos(String(nombre || '').toUpperCase().trim());
    for (var i = 0; i < MESES_TXT.length; i++) {
      if (n === MESES_TXT[i] || n.indexOf(MESES_TXT[i].substring(0, 4)) === 0) return i + 1;
    }
    return 0;
  }

  // ---------------- PDF ----------------

  function lineasDeContenidoPdf(txt) {
    var re = /\((?:[^()\\]|\\.)*\)|(-?[\d.]+)\s+(-?[\d.]+)\s+(Td|TD|T\*)|(\bET\b)/g;
    var out = [], m, linea = '';
    while ((m = re.exec(txt)) !== null) {
      var tok = m[0];
      if (tok.charAt(0) === '(') {
        linea += desescaparPdf(tok.substring(1, tok.length - 1));
      } else if (m[3]) {
        if (linea.trim()) out.push(linea);
        linea = '';
        if (parseFloat(m[2]) !== 0) out.push('\n');
      } else if (m[4]) {
        if (linea.trim()) out.push(linea);
        linea = '';
        out.push('\n');
      }
    }
    if (linea.trim()) out.push(linea);
    return out.join('').replace(/es-AR/g, '');
  }

  function desescaparPdf(t) {
    return t.replace(/\\([nrtbf()\\])/g, function (a, c) {
      return ({ n: ' ', r: ' ', t: ' ', b: ' ', f: ' ', '(': '(', ')': ')', '\\': '\\' })[c] || c;
    }).replace(/\\([0-7]{1,3})/g, function (a, o) {
      return String.fromCharCode(parseInt(o, 8));
    });
  }

  async function extraerTextoPdf(arrayBuffer) {
    var s = aLatin1(arrayBuffer);
    var lineas = [];
    var idx = 0;
    while ((idx = s.indexOf('stream', idx)) !== -1) {
      // saltar "endstream"
      if (idx >= 3 && s.substring(idx - 3, idx) === 'end') { idx += 6; continue; }
      var desp = idx + 6;
      if (s.charCodeAt(desp) === 13) desp++;
      if (s.charCodeAt(desp) !== 10) { idx += 6; continue; }
      desp++;
      var fin = s.indexOf('endstream', desp);
      if (fin === -1) break;
      var datosBrutos = u8DesdeLatin1(s.substring(desp, fin));
      idx = fin + 9;
      // inflar probando formatos y recortes
      var data = null;
      var cortes = [0, -2, -1];
      var formatos = ['deflate', 'deflate-raw'];
      for (var f = 0; f < formatos.length && !data; f++) {
        for (var c = 0; c < cortes.length && !data; c++) {
          var finB = cortes[c] === 0 ? datosBrutos.length : datosBrutos.length + cortes[c];
          if (finB <= 0) continue;
          try { data = await inflar(datosBrutos.subarray(0, finB), formatos[f]); } catch (e) {}
        }
      }
      if (!data) continue;
      var txt = aLatin1(data);
      if (txt.indexOf('BT') === -1) continue;
      var bloque = lineasDeContenidoPdf(txt);
      lineas.push(bloque);
    }
    return lineas.join('\n');
  }

  // ---------------- DOC (binario) y DOCX ----------------

  function extraerTextoDoc(arrayBuffer) {
    var s = aLatin1(arrayBuffer);
    var re = /[\x20-\x7E\xA0-\xFF]{4,}/g, m;
    var out = [];
    while ((m = re.exec(s)) !== null) {
      var t = m[0].replace(/\s+/g, ' ').trim();
      // texto "plausible": letras/dígitos/espacios y puntuación típica
      if (!/[\d]/.test(t) && !/[A-Za-zÁÉÍÓÚÑáéíóúñ]{4}/.test(t)) continue;
      var letras = (t.match(/[A-Za-zÁÉÍÓÚÑáéíóúñ0-9\s,.\/°ºª()\-']/g) || []).length;
      if (t.length && letras / t.length < 0.9) continue;
      out.push(t);
    }
    return out.join('\n');
  }

  async function extraerTextoDocx(arrayBuffer) {
    var zip = await leerZip(arrayBuffer);
    var doc = zip['word/document.xml'];
    if (!doc) return extraerTextoDoc(arrayBuffer);
    var xml = aUtf8(doc);
    var parrafos = xml.match(/<w:p[\s>][\s\S]*?<\/w:p>/g) || [];
    var out = [];
    for (var i = 0; i < parrafos.length; i++) {
      var ts = parrafos[i].match(/<w:t[^>]*>[\s\S]*?<\/w:t>/g) || [];
      var txt = '';
      for (var j = 0; j < ts.length; j++) txt += decXml(ts[j].replace(/<[^>]+>/g, ''));
      out.push(txt);
    }
    return out.join('\n');
  }

  // ---------------- Armado de registros ----------------

  function prepararTexto(t) {
    t = String(t || '').replace(/\r/g, '');
    t = t.replace(/es-AR/g, '');
    t = t.replace(/ANI\s+VERSARIO/g, 'ANIVERSARIO');
    t = t.replace(/[–—]/g, '-');
    // juntar números partidos: "19 73" -> "1973", "1 2 /01" -> "12 /01"
    t = t.replace(/(\d)\s+(?=\d)/g, '$1');
    t = t.replace(/(\/)\s+(?=\d)/g, '$1');
    return t;
  }

  function esLineaMes(o) {
    var n = quitarAcentos(String(o.linea || '').toUpperCase().trim());
    for (var i = 0; i < MESES_TXT.length; i++) if (n === MESES_TXT[i]) return true;
    return false;
  }

  var RE_ROL = /^(?:SE[ÑN]ORA|SE[ÑN]OR|SE[ÑN]ORITA|PG|PM|PS|PREFECTO(?:\s+GENERAL)?)$/i;

  function esLineaDepto(linea) {
    var l = String(linea || '').trim();
    if (!l || l.length > 20) return false;
    var partes = l.split(/[\s\/]+/).filter(function (p) { return p; });
    if (!partes.length) return false;
    for (var i = 0; i < partes.length; i++) {
      if (!/^[DSP][A-Z]{1,4}$/.test(partes[i])) return false;
    }
    return true;
  }

  function limpiarNombre(nombre) {
    var n = String(nombre || '').replace(/\s+/g, ' ').trim();
    n = n.replace(/^(?:SE[ÑN]ORA|SE[ÑN]OR|PG|PM)\s+/i, '');
    n = n.replace(/^[\s\-–—.·]+/, '').replace(/[\s\-–—.·]+$/, '');
    n = n.replace(/\s{2,}/g, ' ');
    return n.trim();
  }

  function fechaValida(dd, mm) {
    return !isNaN(dd) && !isNaN(mm) && dd >= 1 && dd <= 31 && mm >= 1 && mm <= 12;
  }

  function buscarFechas(t) {
    var re = /(\d{1,2})\s*\/\s*(\d{1,2})\s*\/\s*(\d{4})/g, m;
    var out = [];
    while ((m = re.exec(t)) !== null) {
      out.push({
        dd: parseInt(m[1], 10),
        mm: parseInt(m[2], 10),
        anio: parseInt(m[3], 10),
        ini: m.index,
        fin: re.lastIndex
      });
    }
    return out;
  }

  // Lista tipo "PG Y ESPOSAS": fecha -> nombre -> tipo
  function parsearListaPG(texto, archivo) {
    var t = prepararTexto(texto);
    var fechas = buscarFechas(t);
    var registros = [], avisos = [];
    for (var i = 0; i < fechas.length; i++) {
      var f = fechas[i];
      if (!fechaValida(f.dd, f.mm) || f.anio < 1500 || f.anio > 2100) continue;
      var finSeg = (i + 1 < fechas.length) ? fechas[i + 1].ini : t.length;
      var seg = t.substring(f.fin, finSeg);

      var mBoda = seg.match(/ANIVERSARIO\s+DE\s+BO?D?A?S?/i);
      var mCum = seg.match(/CUMPLEA[ÑN]OS?/i);
      var tipo = null, posTipo = -1;
      if (mBoda && (!mCum || mBoda.index < mCum.index)) { tipo = 'bodas'; posTipo = mBoda.index; }
      else if (mCum) { tipo = 'cumpleanos'; posTipo = mCum.index; }
      if (!tipo) {
        avisos.push('Fecha ' + pad2(f.dd) + '/' + pad2(f.mm) + ' sin tipo reconocido (' + (archivo || '') + ')');
        continue;
      }

      var antes = seg.substring(0, posTipo).split('\n');
      var nombreParts = [];
      for (var j = 0; j < antes.length; j++) {
        var linea = antes[j].trim();
        if (!linea) continue;
        if (esLineaMes({ linea: linea })) continue;
        if (RE_ROL.test(linea)) continue;
        if (esLineaDepto(linea)) continue;
        nombreParts.push(linea);
      }
      var nombre = limpiarNombre(nombreParts.join(' '));
      if (nombre.length < 4) {
        avisos.push('Fecha ' + pad2(f.dd) + '/' + pad2(f.mm) + ' sin nombre (' + (archivo || '') + ')');
        continue;
      }
      registros.push({ dd: f.dd, mm: f.mm, anio: f.anio, tipo: tipo, nombre: nombre, archivo: archivo || '' });
    }
    return { registros: registros, avisos: avisos };
  }

  // Tabla "PG Y SEÑORAS": nacimiento PG / nacimiento esposa / aniversario de bodas
  function parsearTablaPG(texto, archivo) {
    var t = prepararTexto(texto);
    var fechas = buscarFechas(t);
    var registros = [], avisos = [];
    var i = 0;
    var JUNK = /^(?:FECHA|NACIMIENTO|NOMBRE|ESPOSA.*|CONVI.*|VIENTE|ESPOSAS|ESPOSO|CUMPLEA[ÑN]OS?|ANIVERSARIOS?|BODAS?|PG|PM|PREFECTO|GENERAL|CUATRI|GRAMA|JE|RA|R|Y|DE|DEL|LAS|LOS|LA|EL|20\d\d)$/i;

    function limpiarNombreTabla(s) {
      var partes = String(s || '').split(/\s+/);
      var out = [];
      for (var k = 0; k < partes.length; k++) {
        var p = partes[k].trim();
        if (!p) continue;
        if (JUNK.test(p)) continue;
        if (p.length <= 2 && !/[A-Za-zÁÉÍÓÚÑáéíóúñ]{2}/.test(p)) continue;
        out.push(p);
      }
      return limpiarNombre(out.join(' '));
    }

    while (i < fechas.length) {
      var fA = fechas[i];
      if (!fechaValida(fA.dd, fA.mm) || fA.anio < 1500 || fA.anio > 2100) { i++; continue; }

      // segmento antes de la primera fecha = fila del PG
      var iniSeg = (i > 0) ? fechas[i - 1].fin : 0;
      var segPG = t.substring(iniSeg, fA.ini);
      var fB = (i + 1 < fechas.length) ? fechas[i + 1] : null;
      var fC = (i + 2 < fechas.length) ? fechas[i + 2] : null;

      var segEsposa = '';
      var hayAniversario = false;
      if (fB && fechaValida(fB.dd, fB.mm)) {
        segEsposa = t.substring(fA.fin, fB.ini);
        if (fC && fechaValida(fC.dd, fC.mm)) {
          var segC = t.substring(fB.fin, fC.ini).trim();
          // entre nacimiento de esposa y aniversario no debe haber texto
          hayAniversario = !/[A-Za-zÁÉÍÓÚÑáéíóúñ]{3}/.test(segC);
        }
      }

      var nombrePG = limpiarNombreTabla(segPG);
      if (nombrePG.length >= 4) {
        registros.push({ dd: fA.dd, mm: fA.mm, anio: fA.anio, tipo: 'cumpleanos', nombre: nombrePG, archivo: archivo || '' });
      } else {
        avisos.push('Fila de tabla sin nombre PG cerca de ' + pad2(fA.dd) + '/' + pad2(fA.mm) + ' (' + (archivo || '') + ')');
      }

      if (fB && fechaValida(fB.dd, fB.mm)) {
        var nombreEsposa = limpiarNombreTabla(segEsposa);
        if (nombreEsposa.length >= 4) {
          registros.push({ dd: fB.dd, mm: fB.mm, anio: fB.anio, tipo: 'cumpleanos', nombre: nombreEsposa, archivo: archivo || '' });
        }
        if (hayAniversario && nombrePG.length >= 4) {
          var apellido = nombrePG.split(',')[0];
          if (apellido.split(' ').length > 3) apellido = nombrePG.split(' ')[0];
          registros.push({
            dd: fC.dd, mm: fC.mm, anio: fC.anio, tipo: 'bodas',
            nombre: limpiarNombre(apellido) + ' Y SRA', archivo: archivo || ''
          });
          i += 3;
        } else {
          i += 2;
        }
      } else {
        i += 1;
      }
    }
    return { registros: registros, avisos: avisos };
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  // Detecta qué parser conviene para un texto extraído de PDF/DOC
  function parsearTextoPersonas(texto, archivo) {
    var t = String(texto || '');
    var esTabla = /ESPOSA\s*\/?\s*CONVI\s*VIENTE/i.test(t) || /FECHA\s+DE\s+ANIVERSARIO/i.test(t);
    var res = esTabla ? parsearTablaPG(t, archivo) : parsearListaPG(t, archivo);
    res.esTabla = esTabla;
    return res;
  }

  // ---------------- Notas oficiales (PDF) ----------------

  var MESES_NOTA = {
    enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6,
    julio: 7, agosto: 8, septiembre: 9, setiembre: 9, octubre: 10,
    noviembre: 11, diciembre: 12
  };

  function limpiarEspacios(s) {
    return String(s || '').replace(/\s+/g, ' ').trim();
  }

  function esNotaOficial(texto) {
    var t = limpiarEspacios(texto);
    var c = t.replace(/\s+/g, '');
    if (/De mi mayor consideraci/i.test(t) || /demimayorconsideraci/i.test(c)) return true;
    var refOk = /Referencia\s*:/i.test(t) || /referencia:/i.test(c);
    var copOk = /Con Copia A:/i.test(t) || /concopiaa:/i.test(c);
    return refOk && copOk;
  }

  function parsearNota(texto, archivo) {
    var t = String(texto || '').replace(/\r/g, '');
    var hoy = new Date();
    var anioBase = hoy.getFullYear();
    var hoyMes = hoy.getMonth() + 1;
    var nota = {
      archivo: archivo || '',
      titulo: '',
      fecha: '',
      horaInicio: '',
      horaFin: '',
      ubicacion: '',
      descripcion: '',
      avisos: []
    };

    // Título: líneas no vacías después de "Referencia:" hasta la primer línea en blanco
    var iRef = t.search(/Referencia\s*:/);
    if (iRef >= 0) {
      var despues = t.substring(iRef).split('\n');
      var partesTitulo = [];
      for (var i = 1; i < despues.length; i++) {
        var linea = despues[i].trim();
        if (!linea) { if (partesTitulo.length) break; continue; }
        partesTitulo.push(linea);
        if (partesTitulo.join(' ').length > 140) break;
      }
      nota.titulo = limpiarEspacios(partesTitulo.join(' '));
    }
    if (!nota.titulo) {
      nota.avisos.push('Sin "Referencia:" — revisá el título');
      nota.titulo = String(archivo || '').replace(/\.pdf$/i, '');
    }

    // El resto del análisis se hace con el texto en una sola línea
    // (el extractor parte renglones incluso entre "en" y "la Sala")
    t = t.replace(/[ \t]*\n[ \t]*/g, ' ').replace(/\s{2,}/g, ' ');

    // Destinatarios → descripción
    var mA = t.match(/\bA:\s*([\s\S]{0,500}?)(?:Con Copia A:|De mi mayor)/);
    var mC = t.match(/Con Copia A:\s*([\s\S]{0,500}?)(?:De mi mayor)/);
    var para = mA ? limpiarEspacios(mA[1]) : '';
    var copia = mC ? limpiarEspacios(mC[1]) : '';
    if (para) nota.descripcion = 'Para: ' + para;
    if (copia) nota.descripcion += (nota.descripcion ? '\n' : '') + 'Con copia: ' + copia;

    // Fecha
    var dd = null, mm = null, anio = null, m;
    if ((m = t.match(/el día (\d{1,2})\s+de\s+([a-záéíóúñ]+)(?:\s+de\s+(?:año\s+)?(\d{4}))?/i))) {
      dd = +m[1]; mm = MESES_NOTA[quitarAcentos(m[2]).toLowerCase()]; anio = m[3] ? +m[3] : null;
    } else if ((m = t.match(/el día (\d{1,2})\s+del\s+corriente/i))) {
      dd = +m[1]; mm = hoyMes;
    } else if ((m = t.match(/el día (\d{1,2})\s+del\s+pr[oó]ximo\s+mes/i))) {
      dd = +m[1];
      mm = (hoyMes === 12) ? 1 : hoyMes + 1;
      if (hoyMes === 12) anio = anioBase + 1;
    } else if ((m = t.match(/el día (\d{1,2})\s*\/\s*(\d{1,2})(?:\s*\/\s*(\d{4}))?/))) {
      dd = +m[1]; mm = +m[2]; anio = m[3] ? +m[3] : null;
    } else if ((m = t.match(/\b(?:el|del|desde el) (\d{1,2})\s+de\s+([a-záéíóúñ]+)/i))) {
      dd = +m[1]; mm = MESES_NOTA[quitarAcentos(m[2]).toLowerCase()];
    }
    if (dd && mm && mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) {
      if (!anio) {
        anio = anioBase;
        if (mm < hoyMes && (hoyMes - mm) > 6) anio = anioBase + 1;
      }
      nota.fecha = anio + '-' + pad2(mm) + '-' + pad2(dd);
    } else {
      nota.avisos.push('Fecha no reconocida — completar a mano');
    }

    // Horario
    var hm;
    if ((hm = t.match(/de las (\d{1,2})(?::(\d{2}))?\s*(?:hs|horas)?\s*(?:a|al)\s*las (\d{1,2})(?::(\d{2}))?/i))) {
      nota.horaInicio = pad2(+hm[1]) + ':' + pad2(parseInt(hm[2] || '0', 10));
      nota.horaFin = pad2(+hm[3]) + ':' + pad2(parseInt(hm[4] || '0', 10));
    } else if ((hm = t.match(/a (?:partir de )?las (\d{1,2})(?::(\d{2}))?\s*(?:hs\b|horas)?/i))) {
      var hi = +hm[1], mi = parseInt(hm[2] || '0', 10);
      nota.horaInicio = pad2(hi) + ':' + pad2(mi);
      var hf = hi + 1;
      nota.horaFin = pad2(hf > 23 ? 23 : hf) + ':' + pad2(mi);
    }

    // Ubicación: primero lugares típicos ("en la Sala ..."), si no,
    // la primera "en la/el <Lugar con Mayúscula>" descartando referencias legales
    var mU = t.match(/\ben (?:la|el|los|las) (Sala\b[^.]{0,89}|Edificio\b[^.]{0,89}|Aula\b[^.]{0,89}|Sal[oó]n\b[^.]{0,89}|Oficina\b[^.]{0,89}|Sede\b[^.]{0,89}|Predio\b[^.]{0,89}|Dep[oó]sito\b[^.]{0,89}|Base\b[^.]{0,89}|Prefectura\b[^.]{0,89}|Direcci[oó]n\b[^.]{0,89})/i);
    if (mU) {
      nota.ubicacion = limpiarEspacios(mU[1]);
    } else {
      var reU = /\ben (?:la|el|los|las) ([A-ZÁÉÍÓÚ][^.]{2,89})/g, mG;
      while ((mG = reU.exec(t)) !== null) {
        var cand = limpiarEspacios(mG[1]);
        if (/^(Decreto|Ley|Art[ií]culo|Resoluci|Circular|Anexo|Inciso|P[aá]rrafo|Punto|Ap[eé]ndice|Num)/i.test(cand)) continue;
        nota.ubicacion = cand;
        break;
      }
    }

    return nota;
  }

  // ---------------- Deduplicación ----------------

  function claveFecha(r) { return pad2(r.mm) + '-' + pad2(r.dd); }

  // Marca registros repetidos dentro del mismo lote (devuelve índice del original)
  function duplicadoEnLote(registros, idx) {
    var r = registros[idx];
    for (var i = 0; i < idx; i++) {
      var o = registros[i];
      if (o._omite) continue;
      if (claveFecha(o) !== claveFecha(r)) continue;
      if (!tiposCompatibles(o.tipo, r.tipo)) continue;
      if (nombresCoinciden(o.nombre, r.nombre)) return i;
    }
    return -1;
  }

  // Marca registros que ya existen en el calendario (eventos cargados)
  function duplicadoEnCalendario(registro, eventos) {
    if (!eventos || !eventos.length) return null;
    var clave = claveFecha(registro);
    for (var i = 0; i < eventos.length; i++) {
      var ev = eventos[i];
      var fechaEv = String(ev.inicio || '').substring(5, 10); // mm-dd
      if (fechaEv !== clave) continue;
      var tipoEv = tipoDeTitulo(ev.titulo);
      if (!tiposCompatibles(registro.tipo, tipoEv)) continue;
      if (nombresCoinciden(registro.nombre, ev.titulo)) return ev;
    }
    return null;
  }

  // ---------------- Export ----------------

  var API = {
    aLatin1: aLatin1,
    claveTexto: claveTexto,
    tokensTexto: tokensTexto,
    nombresCoinciden: nombresCoinciden,
    tipoDeTitulo: tipoDeTitulo,
    tiposCompatibles: tiposCompatibles,
    leerZip: leerZip,
    parsearCeldas: parsearCeldas,
    importarXLSX: importarXLSX,
    extraerTextoPdf: extraerTextoPdf,
    extraerTextoDoc: extraerTextoDoc,
    extraerTextoDocx: extraerTextoDocx,
    prepararTexto: prepararTexto,
    parsearListaPG: parsearListaPG,
    parsearTablaPG: parsearTablaPG,
    parsearTextoPersonas: parsearTextoPersonas,
    claveFecha: claveFecha,
    duplicadoEnLote: duplicadoEnLote,
    duplicadoEnCalendario: duplicadoEnCalendario,
    esNotaOficial: esNotaOficial,
    parsearNota: parsearNota
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  global.Imp = API;
})(typeof window !== 'undefined' ? window : globalThis);
