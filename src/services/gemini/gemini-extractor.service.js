/*
  Serviço responsável por extrair dados de comprovantes Pix usando Gemini.

  Responsabilidades:
  1. Receber o caminho local de uma imagem.
  2. Converter a imagem para Base64.
  3. Enviar a imagem para a Gemini API.
  4. Pedir que o modelo retorne somente JSON.
  5. Normalizar a resposta em um objeto JavaScript.

  Observação:
  Este serviço não usa Google Vision.
  Ele é usado no benchmark isolado do Gemini.
*/

const fs = require("fs");
const path = require("path");

const GEMINI_API_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

function obterModeloGemini() {
  return process.env.GEMINI_MODEL || "gemini-1.5-flash";
}

function obterGeminiApiKey() {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    throw new Error("GEMINI_API_KEY não definida no arquivo .env");
  }

  return apiKey;
}

function obterMimeType(caminhoImagem) {
  const ext = path.extname(caminhoImagem).toLowerCase();

  const mimeTypes = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp"
  };

  return mimeTypes[ext] || "application/octet-stream";
}

function imagemParaBase64(caminhoImagem) {
  return fs.readFileSync(caminhoImagem).toString("base64");
}

function criarPromptExtracaoPix() {
  return `
Você é um extrator de dados de comprovantes Pix brasileiros.

Analise a imagem e retorne SOMENTE um JSON válido.
Não use markdown.
Não use comentários.
Não escreva texto fora do JSON.

Objetivo principal:
Extrair o ID E2E / EndToEndId / ID da transação Pix exatamente como aparece.

Regras importantes:
- Preserve letras maiúsculas e minúsculas do E2E.
- Preserve números e letras exatamente.
- Não corrija caracteres por suposição.
- Se houver dúvida visual entre 0/o/O, 1/l/I, 5/S/s, 6/S/s/G, 8/B, informe em caracteresAmbiguos.
- O E2E deve ter 32 caracteres.
- O E2E geralmente começa com E ou D.
- Se não encontrar E2E, use null.
- Se encontrar valor, retorne amountCentavos como número inteiro em centavos.
- Se não encontrar algum campo, use null.

Formato obrigatório do JSON:
{
  "documentoEhComprovantePix": true,
  "e2e": {
    "valor": null,
    "tipo": null,
    "confianca": "baixa",
    "temCaracteresAmbiguos": false,
    "caracteresAmbiguos": []
  },
  "valor": {
    "texto": null,
    "amountCentavos": null,
    "currency": "BRL"
  },
  "dataHora": {
    "data": null,
    "hora": null,
    "textoOriginal": null
  },
  "participantes": {
    "pagadorNome": null,
    "recebedorNome": null,
    "instituicao": null
  },
  "linhasRelevantes": [],
  "observacoes": []
}
`;
}

function extrairTextoRespostaGemini(data) {
  return data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
}

function limparPossivelMarkdownJson(texto) {
  if (!texto) return "";

  return texto
    .trim()
    .replace(/^```json/i, "")
    .replace(/^```/i, "")
    .replace(/```$/i, "")
    .trim();
}

function parsearJsonGemini(texto) {
  const textoLimpo = limparPossivelMarkdownJson(texto);

  if (!textoLimpo) {
    throw new Error("Gemini retornou resposta vazia");
  }

  try {
    return JSON.parse(textoLimpo);
  } catch (error) {
    throw new Error(`Gemini retornou JSON inválido: ${error.message}`);
  }
}

function normalizarRespostaGemini(json) {
  return {
    documentoEhComprovantePix: Boolean(json?.documentoEhComprovantePix),
    e2e: {
      valor: json?.e2e?.valor || null,
      tipo: json?.e2e?.tipo || null,
      confianca: json?.e2e?.confianca || "baixa",
      temCaracteresAmbiguos: Boolean(json?.e2e?.temCaracteresAmbiguos),
      caracteresAmbiguos: Array.isArray(json?.e2e?.caracteresAmbiguos)
        ? json.e2e.caracteresAmbiguos
        : []
    },
    valor: {
      texto: json?.valor?.texto || null,
      amountCentavos:
        typeof json?.valor?.amountCentavos === "number"
          ? json.valor.amountCentavos
          : null,
      currency: json?.valor?.currency || "BRL"
    },
    dataHora: {
      data: json?.dataHora?.data || null,
      hora: json?.dataHora?.hora || null,
      textoOriginal: json?.dataHora?.textoOriginal || null
    },
    participantes: {
      pagadorNome: json?.participantes?.pagadorNome || null,
      recebedorNome: json?.participantes?.recebedorNome || null,
      instituicao: json?.participantes?.instituicao || null
    },
    linhasRelevantes: Array.isArray(json?.linhasRelevantes)
      ? json.linhasRelevantes
      : [],
    observacoes: Array.isArray(json?.observacoes) ? json.observacoes : []
  };
}

async function extrairDadosComprovanteComGemini(caminhoImagem) {
  const apiKey = obterGeminiApiKey();
  const model = obterModeloGemini();

  const mimeType = obterMimeType(caminhoImagem);
  const imageBase64 = imagemParaBase64(caminhoImagem);

  const url = `${GEMINI_API_BASE_URL}/models/${model}:generateContent`;

  const body = {
    contents: [
      {
        role: "user",
        parts: [
          {
            text: criarPromptExtracaoPix()
          },
          {
            inlineData: {
              mimeType,
              data: imageBase64
            }
          }
        ]
      }
    ],
    generationConfig: {
      temperature: 0,
      responseMimeType: "application/json"
    }
  };

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey
    },
    body: JSON.stringify(body)
  });

  const data = await response.json();

  if (!response.ok) {
    const mensagemErro =
      data?.error?.message || `Erro HTTP ${response.status} na Gemini API`;

    throw new Error(mensagemErro);
  }

  const textoResposta = extrairTextoRespostaGemini(data);
  const json = parsearJsonGemini(textoResposta);
  const dados = normalizarRespostaGemini(json);

  return {
    model,
    rawText: textoResposta,
    dados
  };
}

module.exports = {
  extrairDadosComprovanteComGemini
};