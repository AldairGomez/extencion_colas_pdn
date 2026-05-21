// --- CONFIGURACIÓN DE SUPABASE ---
const SUPABASE_URL = 'https://immlqldjdrgaituledea.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_paYTh9a44vOiOYcWaVdXcA_cn0PBWUl';

const MAPA_CONSULTORIOS = {
    "Triaje": "TRIAJE (1er Piso)",
    "Laboratorio": "LABORATORIO (1er Piso)",
    "Radiología": "RAYOS X (1er Piso)",
    "Examen Neurologico": "NEUROLOGIA (1er Piso)",
    "Psicosensometrico": "PSICOSENSOMETRICO (1er Piso)",
    "Psicología": "PSICOLOGIA (1er Piso)",
    "Antecedentes Personales": "MEDICINA (2do Piso)",
    "Historia Ocupacional": "MEDICINA (2do Piso)",
    "Medicina": "MEDICINA (2do Piso)",
    "Mus. Esqueletico": "MEDICINA (2do Piso)",
    "7D": "MEDICINA (2do Piso)",
    "Altura Estructural": "MEDICINA (2do Piso)",
    "SAS": "MEDICINA (2do Piso)",
    "Manipulador de Alimentos": "MEDICINA (2do Piso)",
    "Examen de Manejo": "MEDICINA (2do Piso)",
    "Mecanica Soldadores": "MEDICINA (2do Piso)",
    "Espacios Confinados": "MEDICINA (2do Piso)",
    "Covid 19": "MEDICINA (2do Piso)",
    "Diagnostico": "MEDICINA (2do Piso)",
    "Ginecologia": "MEDICINA (2do Piso)",
    "Visita Antamina": "MEDICINA (2do Piso)",
    "Visita Antapaccay": "MEDICINA (2do Piso)",
    "Cardiología": "CARDIOLOGIA (2do Piso)",
    "Prueba de Esfuerzo": "CARDIOLOGIA (2do Piso)",
    "Oftalmología": "OFTALMOLOGIA (2do Piso)",
    "Audiometría": "AUDIOMETRIA (2do Piso)",
    "Odontología": "ODONTOLOGIA (2do Piso)",
    "Ecografia": "ECOGRAFIA (2do Piso)",
    "Espirometría": "ESPIROMETRIA (2do Piso)"
};

let isSyncing = false;
let monitorUI = null;
let estadoAnterior = {}; // Memoria RAM de la última versión enviada a Supabase

const TAB_ID = Math.random().toString(36).substring(2, 15);
const LOCK_KEY = 'mediweb_sync_lock';

// --- CONTROL DE PESTAÑA ÚNICA ---
function soyPestanaMaestra() {
    try {
        const lockStr = localStorage.getItem(LOCK_KEY);
        const lock = lockStr ? JSON.parse(lockStr) : { time: 0, id: '' };
        const now = Date.now();
        // Si el lock expiró (más de 6 segundos) o yo soy el dueño
        if (now - lock.time > 6000 || lock.id === TAB_ID) {
            localStorage.setItem(LOCK_KEY, JSON.stringify({ id: TAB_ID, time: now }));
            return true;
        }
        return false;
    } catch(e) {
        return true; // En caso de error, asumir maestra para no bloquear
    }
}

// --- VALIDACIÓN DE FECHA ACTUAL ---
function esFechaActual() {
    const params = new URLSearchParams(window.location.search);
    const fechaInicio = params.get('fechainicio');
    const fechaFinal = params.get('fechafinal');

    const hoy = new Date();
    const dia = String(hoy.getDate()).padStart(2, '0');
    const mes = String(hoy.getMonth() + 1).padStart(2, '0');
    const anio = hoy.getFullYear();
    const fechaHoyStr = `${dia}-${mes}-${anio}`;

    // Si la URL no tiene parámetros, asume que es el día actual.
    if (!fechaInicio && !fechaFinal) return true;
    
    // Si tiene, debe coincidir exactamente con hoy.
    if ((fechaInicio && fechaInicio !== fechaHoyStr) || (fechaFinal && fechaFinal !== fechaHoyStr)) {
        return false;
    }
    return true;
}

// --- GESTIÓN DE CACHÉ CON CADUCIDAD (AMNESIA CONTROLADA) ---
function obtenerCache() {
    return JSON.parse(sessionStorage.getItem('mediweb_cache_pacientes') || '{}');
}
function guardarEnCache(id, datos) {
    const cache = obtenerCache();
    datos.timestamp = Date.now(); // Guardamos el momento exacto
    cache[id] = datos;
    sessionStorage.setItem('mediweb_cache_pacientes', JSON.stringify(cache));
}

// --- COMUNICACIÓN CON SUPABASE ---
async function enviarASupabase(paciente) {
    const url = `${SUPABASE_URL}/rest/v1/turnos_activos`;
    const especialidadesPostgres = `{${paciente.pendientes.map(p => `"${p}"`).join(',')}}`;

    const body = {
        id_mediweb: paciente.id_mediweb,
        dni: paciente.dni,
        nombre_paciente: paciente.nombre,
        sexo: paciente.sexo,
        edad: paciente.edad,
        perfiles: paciente.perfiles,
        consultorios_pendientes: especialidadesPostgres,
        estado: "ESPERA"
    };

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'apikey': SUPABASE_ANON_KEY,
                'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
                'Content-Type': 'application/json',
                'Prefer': 'resolution=merge-duplicates'
            },
            body: JSON.stringify(body)
        });
        if (response.ok) {
            console.log(`🚀 [CAMBIO DETECTADO] Upsert en Supabase -> ${paciente.nombre} | Pendientes: ${paciente.pendientes.length} | Sexo: ${paciente.sexo}`);
        }
    } catch (e) {
        console.error("Error upsert:", e);
    }
}

async function eliminarDeSupabase(idMediweb) {
    const url = `${SUPABASE_URL}/rest/v1/turnos_activos?id_mediweb=eq.${idMediweb}`;
    try {
        await fetch(url, {
            method: 'DELETE',
            headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` }
        });
        console.log(`🗑️ [BORRADO FÍSICO] Paciente ID ${idMediweb} eliminado de la BD.`);
        delete estadoAnterior[idMediweb]; // Lo quitamos también de la memoria RAM
    } catch (e) {
        console.error("Error al borrar:", e);
    }
}

// --- EL IFRAME INVISIBLE ---
function extraerDatosConIframe(url) {
    return new Promise((resolve) => {
        const iframe = document.createElement('iframe');
        iframe.style.cssText = "width:0;height:0;border:0;position:absolute;left:-9999px;visibility:hidden;";
        let resuelto = false;

        iframe.onload = () => {
            if (resuelto) return;
            try {
                const doc = iframe.contentWindow.document;
                if (doc.location.href === 'about:blank' || doc.URL === 'about:blank') return;

                let intentos = 0;
                const verificador = setInterval(() => {
                    const inDni = doc.getElementById('dni');
                    if (inDni && inDni.value) {
                        clearInterval(verificador);
                        resuelto = true;
                        let datos = {
                            dni: inDni.value.trim(),
                            sexo: doc.getElementById('sexo') ? doc.getElementById('sexo').value.trim() : "SIN_DATO",
                            edad: doc.getElementById('edad') ? doc.getElementById('edad').value.trim() : "0"
                        };
                        document.body.removeChild(iframe);
                        resolve(datos);
                    } else {
                        intentos++;
                        if (intentos >= 10) {
                            clearInterval(verificador);
                            resuelto = true;
                            document.body.removeChild(iframe);
                            resolve({ dni: "SIN_DNI", sexo: "SIN_DATO", edad: "0" });
                        }
                    }
                }, 400);
            } catch (e) {
                resuelto = true;
                if (document.body.contains(iframe)) document.body.removeChild(iframe);
                resolve({ dni: "SIN_DNI", sexo: "SIN_DATO", edad: "0" });
            }
        };
        iframe.src = url;
        document.body.appendChild(iframe);
    });
}

// --- LÓGICA PRINCIPAL (REFRESCO FANTASMA MULTI-PÁGINA + SMART DIFF) ---
async function cicloSincronizacion() {
    if (isSyncing) return;
    isSyncing = true;

    if (!soyPestanaMaestra()) {
        actualizarUI("⏸️ Pausado (Otra pestaña activa)", "#555555");
        isSyncing = false;
        setTimeout(cicloSincronizacion, 3000);
        return;
    }

    if (!esFechaActual()) {
        actualizarUI("⏸️ Pausado (Fecha pasada)", "#ff5555");
        isSyncing = false;
        setTimeout(cicloSincronizacion, 3000);
        return;
    }

    actualizarUI("Buscando cambios...", "#FFA500");
    const cache = obtenerCache();

    try {
        // 1. OBTENER URLS DE TODAS LAS PÁGINAS (PAGINACIÓN)
        const responsePrincipal = await fetch(window.location.href, { cache: 'no-store' });
        if (!responsePrincipal.ok) throw new Error("Fallo de red al obtener página principal");
        
        const htmlPrincipal = await responsePrincipal.text();
        const docPrincipal = new DOMParser().parseFromString(htmlPrincipal, 'text/html');
        
        // Validar que no estemos en una página de error o caída de servidor
        if (!docPrincipal.querySelector('table')) {
            throw new Error("Estructura HTML inválida o sesión expirada");
        }

        const urlsAParcear = new Set([window.location.href]);

        // Extraer todos los enlaces de números (ignoramos 'Siguiente' / 'Anterior' porque no son números)
        const enlacesPaginacion = docPrincipal.querySelectorAll('.FacetDataTD center a');
        enlacesPaginacion.forEach(enlace => {
            const textoEnlace = enlace.innerText.trim();
            if (!isNaN(textoEnlace) && textoEnlace !== "") {
                urlsAParcear.add(enlace.href);
            }
        });

        const pacientesAProcesar = [];
        const idsProcesados = new Set(); // Evita pacientes repetidos si Mediweb duplica datos

        // 2. REFRESCO FANTASMA MULTI-PÁGINA
        for (const url of urlsAParcear) {
            let htmlPagina = htmlPrincipal;
            let docVirtual = docPrincipal;

            if (url !== window.location.href) {
                const response = await fetch(url, { cache: 'no-store' });
                if (!response.ok) continue; // Si falla solo una pagina, continuamos con las demás
                htmlPagina = await response.text();
                docVirtual = new DOMParser().parseFromString(htmlPagina, 'text/html');
            }

            const filas = docVirtual.querySelectorAll('tr[onmouseover="rowOverEffect(this)"]');
            for (const fila of filas) {
                const celdas = fila.querySelectorAll('td');
                if (celdas.length > 7) {
                    const nombreCompleto = celdas[6].innerText.trim();
                    const enlaceHistoria = fila.querySelector('a[href*="idseccion=21"]');

                    if (enlaceHistoria) {
                        const linkRelativo = enlaceHistoria.getAttribute('href');
                        const urlObj = new URL(linkRelativo, window.location.href);
                        const idInterno = parseInt(urlObj.searchParams.get('idpaciente'));

                        if (idInterno && !idsProcesados.has(idInterno)) {
                            idsProcesados.add(idInterno);
                            const consultoriosPendientes = new Set();
                            const celdasEspecialidades = Array.from(celdas).slice(8);

                            celdasEspecialidades.forEach(celda => {
                                const img = celda.querySelector('img');
                                if (img) {
                                    const asig = MAPA_CONSULTORIOS[img.getAttribute('title')];
                                    if (asig) consultoriosPendientes.add(asig);
                                }
                            });

                            pacientesAProcesar.push({
                                id_mediweb: idInterno,
                                nombre: nombreCompleto,
                                url_extraccion: urlObj.href,
                                pendientes: Array.from(consultoriosPendientes)
                            });
                        }
                    }
                }
            }
        }

        const idsEnPantallaFantasma = pacientesAProcesar.map(p => p.id_mediweb);

        // 3. EXTRACCIÓN CON CADUCIDAD (Amnesia cada 15 seg)
        const promesasExtraccion = pacientesAProcesar.map(async (paciente, index) => {
            const cached = cache[paciente.id_mediweb];
            const tiempoTranscurrido = cached ? (Date.now() - cached.timestamp) : Infinity;

            if (cached && tiempoTranscurrido < 15000) {
                return { ...paciente, dni: cached.dni, sexo: cached.sexo, edad: cached.edad };
            }

            console.log(`🕵️‍♂️ Escaneando DNI/Sexo/Edad de: ${paciente.nombre} (Nuevo o Caché caducado)`);
            await new Promise(r => setTimeout(r, index * 250)); // Pequeño retraso para no sobrecargar
            const infoExtra = await extraerDatosConIframe(paciente.url_extraccion);
            guardarEnCache(paciente.id_mediweb, infoExtra);
            return { ...paciente, ...infoExtra };
        });

        const pacientesExtraidos = await Promise.all(promesasExtraccion);

        // 4. ANÁLISIS DE PERFILES (DNIs repetidos)
        const conteoDNI = {};
        pacientesExtraidos.forEach(p => {
            if (p.dni !== "SIN_DNI") conteoDNI[p.dni] = (conteoDNI[p.dni] || 0) + 1;
        });

        // 5. SMART DIFF (Solo envía si hay cambios)
        const promesasEnvio = pacientesExtraidos.map(async (p) => {
            p.perfiles = conteoDNI[p.dni] || 1;

            const datosParaComparar = {
                pendientes: p.pendientes.join(','),
                dni: p.dni,
                sexo: p.sexo,
                edad: p.edad,
                perfiles: p.perfiles
            };
            const hashActual = JSON.stringify(datosParaComparar);

            if (estadoAnterior[p.id_mediweb] !== hashActual) {
                estadoAnterior[p.id_mediweb] = hashActual;
                await enviarASupabase(p);
            }
        });
        await Promise.all(promesasEnvio);

        // 6. EFECTO ESPEJO (Eliminar borrados)
        const respGet = await fetch(`${SUPABASE_URL}/rest/v1/turnos_activos?select=id_mediweb`, {
            headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` }
        });

        if (respGet.ok) {
            const dataSupabase = await respGet.json();
            const idsEnSupabase = dataSupabase.map(r => r.id_mediweb);

            // IMPORTANTE: Ya no elimina si desaparece de la pag 1, sino de TODAS las paginas.
            const paraBorrar = idsEnSupabase.filter(id => !idsEnPantallaFantasma.includes(id));

            const promesasBorrado = paraBorrar.map(id => eliminarDeSupabase(id));
            await Promise.all(promesasBorrado);
        }

        actualizarUI("✅ Monitoreando (Live)", "#00CC00");

    } catch (error) {
        console.error("Error en el ciclo:", error);
        actualizarUI("⚠️ Error de Red / HTML", "#FF0000");
    }

    isSyncing = false;
    setTimeout(cicloSincronizacion, 3000);
}

// --- CREACIÓN DEL MONITOR UI ---
function actualizarUI(texto, color) {
    if (monitorUI) {
        monitorUI.innerText = texto;
        monitorUI.style.backgroundColor = color || '#00CC00';
    }
}

function crearMonitor() {
    if (document.getElementById('monitor-sync-mediweb')) return;

    monitorUI = document.createElement('div');
    monitorUI.id = 'monitor-sync-mediweb';
    monitorUI.innerText = 'Iniciando Escáner...';
    monitorUI.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:999999;padding:12px 20px;background-color:#333;color:white;border-radius:50px;font-weight:bold;box-shadow:0px 4px 10px rgba(0,0,0,0.5);font-family:Arial,sans-serif;font-size:13px;transition:0.3s; pointer-events: none;';

    document.body.appendChild(monitorUI);

    cicloSincronizacion();
}

crearMonitor();