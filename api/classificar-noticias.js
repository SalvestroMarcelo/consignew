// api/classificar-noticias.js
// Roda no servidor da Vercel — a chave nunca aparece no navegador do usuário

export default async function handler(req, res) {
    if (req.method !== "POST") {
        return res.status(405).json({ error: "Método não permitido" });
    }

    try {
        const { prompt } = req.body;

        const resposta = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${process.env.NVIDIA_API_KEY}`
            },
            body: JSON.stringify({
                model: "google/gemma-3-4b-it",
                messages: [{ role: "user", content: prompt }],
                temperature: 0.1,
                max_tokens: 2048
            })
        });

        const data = await resposta.json();

        return res.status(resposta.status).json(data);
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
}
