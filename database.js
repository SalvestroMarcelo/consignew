// database.js - Gerenciamento do Banco de Dados Local com Alerta de Erros
const DB_NAME = 'MonitorConsignadoDB';
const DB_VERSION = 1;
let db;

function relatarErroNoApp(contexto, erro) {
    const mensagemCompleta = `[ERRO BANCO DE DADOS]\nOcorreu um problema em: ${contexto}\n\nDetalhes técnicos:\n${erro}\n\nPor favor, copie este texto e envie ao desenvolvedor.`;
    console.error(mensagemCompleta);
    alert(mensagemCompleta);
}

function initDatabase() {
    return new Promise((resolve, reject) => {
        try {
            const request = indexedDB.open(DB_NAME, DB_VERSION);
            request.onerror = (event) => {
                const erroMsg = event.target.error ? event.target.error.message : "Acesso negado ou espaço insuficiente.";
                relatarErroNoApp("initDatabase (abrir banco)", erroMsg);
                reject(erroMsg);
            };
            request.onsuccess = (event) => {
                db = event.target.result;
                resolve(db);
            };
            request.onupgradeneeded = (event) => {
                try {
                    const dbInstance = event.target.result;
                    if (!dbInstance.objectStoreNames.contains('noticias')) {
                        dbInstance.createObjectStore('noticias', { keyPath: 'url' });
                    }
                } catch (err) {
                    relatarErroNoApp("onupgradeneeded (criar tabelas)", err.message);
                }
            };
        } catch (globalErr) {
            relatarErroNoApp("initDatabase (inicialização global)", globalErr.message);
            reject(globalErr.message);
        }
    });
}

function salvarNoticia(noticia) {
    return new Promise((resolve, reject) => {
        try {
            if (!db) throw new Error("Banco de dados não foi inicializado corretamente.");
            const transaction = db.transaction(['noticias'], 'readwrite');
            const store = transaction.objectStore('noticias');
            store.put(noticia);
            transaction.oncomplete = () => resolve();
            transaction.onerror = (event) => {
                const erroMsg = event.target.error ? event.target.error.message : "Falha na transação de escrita.";
                relatarErroNoApp("salvarNoticia (gravar dados)", erroMsg);
                reject(erroMsg);
            };
        } catch (err) {
            relatarErroNoApp("salvarNoticia (execução do bloco)", err.message);
            reject(err.message);
        }
    });
}

function obterTodasNoticias() {
    return new Promise((resolve, reject) => {
        try {
            if (!db) throw new Error("Banco de dados não inicializado.");
            const transaction = db.transaction(['noticias'], 'readonly');
            const store = transaction.objectStore('noticias');
            const request = store.getAll();
            request.onsuccess = () => resolve(request.result);
            request.onerror = (event) => {
                const erroMsg = event.target.error ? event.target.error.message : "Falha na leitura dos dados.";
                relatarErroNoApp("obterTodasNoticias", erroMsg);
                reject(erroMsg);
            };
        } catch (err) {
            relatarErroNoApp("obterTodasNoticias (bloco)", err.message);
            reject(err.message);
        }
    });
}

// === RASTREAMENTO DE LEITURA (localStorage) ===
const STORAGE_KEY = 'monitor_consignado_lidos';

function obterUrlsLidas() {
    try {
        return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    } catch { return {}; }
}

function marcarComoClicada(url) {
    const lidos = obterUrlsLidas();
    lidos[url] = Date.now();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(lidos));
}

function foiClicada(url) {
    const lidos = obterUrlsLidas();
    return !!lidos[url];
}
