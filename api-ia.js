// api-ia.js - Classificação via função serverless (Vercel), com lotes paralelos e resposta compacta (por índice, não por URL)

function relatarErroNaIA(contexto, erro) {
    console.error(`[IA] Erro em ${contexto}:`, erro);
    alert(`[ERRO NA IA]\nFalha em: ${contexto}\nDetalhes: ${erro}`);
}

function montarPrompt(noticias) {
    const listaFormatada = noticias.map((n, i) => {
        const resumoCurto = n.snippet ? n.snippet.substring(0, 200) : "(sem resumo disponível)";
        return `${i}) Título: ${n.titulo}\nResumo: ${resumoCurto}`;
    }).join("\n\n");

    return `Você é um analista especializado em crédito consignado no Brasil, focado exclusivamente no público de SERVIDORES PÚBLICOS (federais, estaduais e municipais), APOSENTADOS, PENSIONISTAS DO INSS e/ou outros pensionistas do setor público.

--- REGRA DE ESCOPO OBRIGATÓRIA (FILTRO ZERO) ---
O foco operacional é estritamente o SETOR PÚBLICO e INSS. 
Qualquer notícia referente ao SETOR PRIVADO (CLT, empresas privadas, sindicatos de indústrias, comércio, serviços privados ou trabalhadores autônomos) DEVE ser automaticamente classificada como "INVIÁVEL" e receber relevância entre 0 e 20, por estar fora do escopo de atuação.

--- CRITÉRIOS DE CLASSIFICAÇÃO ---

VIAVEL: notícias que indicam oportunidades reais no público-alvo (aumento de margem consignável para servidores ou INSS, liberação de novos cartões RMC/RCC, aumentos salariais reais/reajustes aprovados para SERVIDORES PÚBLICOS, novos convênios de consignado abertos com órgãos públicos/prefeituras, ou decisões judiciais/governamentais que facilitam ou expandem o crédito consignado público/INSS).

DUVIDOSA: notícias sobre instabilidade temporária no público-alvo (cortes parciais ou suspensões temporárias de bancos que não afetam o mercado como um todo, greves em órgãos públicos ou no INSS que possam atrasar averbações temporariamente, ou promessas/discursos políticos de reajustes para servidores sem projeto aprovado e sem datas definidas).

INVIAVEL: notícias fora do escopo (SETOR PRIVADO / CLT / Sindicatos de Indústria ou Comércio) ou desfavoráveis ao negócio (redução do teto de juros que afasta os bancos e trava as operações, suspensão definitiva de linhas de crédito público/INSS, fraudes/golpes descobertos no setor, ou reajustes de categorias que não possuem margem consignável em folha).

--- PONTUAÇÃO DE RELEVÂNCIA (0 a 100) ---
Atribua uma relevância indicando a importância estratégica para a gestão do setor:
- 80 a 100: Informação crítica/regulatória no setor público ou INSS que exige ação ou acompanhamento diário.
- 40 a 79: Notícias regionais de médio impacto (convênios municipais/estaduais específicos, greves temporárias em órgãos públicos).
- 0 a 39: Notícias do setor privado (CLT), ruídos políticos sem aprovação ou fatos sem impacto prático no consignado público/INSS.

Notícias para classificar (numeradas de 0 a ${noticias.length - 1}):

${listaFormatada}

Responda APENAS com um array JSON válido, sem blocos de código markdown (como \`\`\`json), sem textos introdutórios e sem explicações. Use o número do item (não repita título nem URL), neste formato exato:
[{"indice": 0, "categoria": "VIAVEL|DUVIDOSA|INVIAVEL", "relevancia": 0}]`;
}

async function processarLote(lote) {
    const prompt = montarPrompt(lote);

    const resposta = await fetch("/api/classificar-noticias", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt })
    });

    if (!resposta.ok) {
        const corpoErro = await resposta.text();
        throw new Error(`HTTP ${resposta.status}: ${corpoErro}`);
    }

    const data = await resposta.json();
    let textoResposta = data.choices?.[0]?.message?.content;

    if (!textoResposta) {
        throw new Error("A IA não retornou conteúdo classificável.");
    }

    textoResposta = textoResposta.replace(/```json/g, "").replace(/```/g, "").trim();

    const inicioArray = textoResposta.indexOf("[");
    const fimArray = textoResposta.lastIndexOf("]");
    if (inicioArray !== -1 && fimArray !== -1) {
        textoResposta = textoResposta.substring(inicioArray, fimArray + 1);
    }

    let classificacoes;
    try {
        classificacoes = JSON.parse(textoResposta);
    } catch (erroParse) {
        console.error("JSON recebido da IA (inválido):", textoResposta);
        throw new Error(`Falha ao interpretar resposta da IA: ${erroParse.message}\n\nTexto recebido (primeiros 500 caracteres):\n${textoResposta.substring(0, 500)}`);
    }

    let contador = 0;
    for (const item of classificacoes) {
        const noticia = lote[item.indice];
        if (!noticia) continue;

        noticia.categoria = item.categoria;
        noticia.relevancia = item.relevancia;

        await salvarNoticia(noticia);
        contador++;
    }

    return contador;
}

async function classificarNoticiasPendentes() {
    try {
        console.log("Buscando notícias pendentes para classificação...");

        const todasNoticias = await obterTodasNoticias();
        const pendentes = todasNoticias.filter(n => n.categoria === 'PENDENTE');

        if (pendentes.length === 0) {
            console.log("Nenhuma notícia pendente para classificar.");
            return;
        }

        const TAMANHO_LOTE = 5;
        const lotes = [];
        for (let i = 0; i < pendentes.length; i += TAMANHO_LOTE) {
            lotes.push(pendentes.slice(i, i + TAMANHO_LOTE));
        }

        console.log(`Processando ${lotes.length} lote(s) em paralelo...`);

        const resultados = await Promise.allSettled(lotes.map(lote => processarLote(lote)));

        let totalClassificadas = 0;
        let totalErros = 0;

        resultados.forEach((resultado, idx) => {
            if (resultado.status === 'fulfilled') {
                totalClassificadas += resultado.value;
            } else {
                totalErros++;
                console.error(`Erro no lote ${idx + 1}:`, resultado.reason);
            }
        });

        console.log(`[SUCESSO] ${totalClassificadas} notícias classificadas.`);
        if (totalErros > 0) {
            relatarErroNaIA(
                "classificarNoticiasPendentes",
                `${totalErros} lote(s) falharam, mas ${totalClassificadas} notícia(s) foram classificadas normalmente.`
            );
        }

    } catch (error) {
        relatarErroNaIA("classificarNoticiasPendentes", error.message);
    }
}
