require("dotenv").config();

const fs = require("fs");
const path = require("path");
const vision = require("@google-cloud/vision");

const PASTA_IMAGENS = path.join(__dirname, "..", "comprovantes-teste");
const PASTA_RELATORIOS = path.join(__dirname, "..", "relatorios");
const PASTA_TEXTOS_EXTRAIDOS = path.join(PASTA_RELATORIOS, "textos-extraidos");
const CAMINHO_RELATORIO = path.join(PASTA_RELATORIOS, "resultado-benchmark.json");

// Formato esperado do E2E Pix:
// E + 8 dígitos do ISPB/banco + 8 dígitos da data + restante alfanumérico
// Exemplo: E0036030520260522130978144db424d
const E2E_REGEX = /[ED]\d{8}\d{8}[A-Za-z0-9]{11,16}/g;

const PALAVRAS_CHAVE_E2E = [
  "e2e",
  "endtoend",
  "endtoendid",
  "endtoendpix",
  "idtransacao",
  "iddatransacao",
  "idtransacao",
  "idpix",
  "idpagamento",
  "idoperacao",
  "identificador",
  "identificadorpix",
  "identificadordatransacao",
  "codigoautenticacao",
  "codigodeautenticacao",
  "autenticacao",
  "codigodatransacao",
  "comprovantepix",
  "transacaopix"
];

function garantirPastas() {
  if (!fs.existsSync(PASTA_RELATORIOS)) {
    fs.mkdirSync(PASTA_RELATORIOS);
  }

  if (!fs.existsSync(PASTA_TEXTOS_EXTRAIDOS)) {
    fs.mkdirSync(PASTA_TEXTOS_EXTRAIDOS);
  }
}

function criarClienteGoogleVision() {
  const projectId = process.env.GOOGLE_CLOUD_PROJECT;

  if (!projectId) {
    throw new Error("GOOGLE_CLOUD_PROJECT não definido no arquivo .env");
  }

  console.log("Google Cloud Project:", projectId);
  console.log("Usando Application Default Credentials do gcloud");
  console.log("");

  return new vision.ImageAnnotatorClient({
    projectId
  });
}

function listarImagens() {
  if (!fs.existsSync(PASTA_IMAGENS)) {
    throw new Error(`Pasta de imagens não encontrada: ${PASTA_IMAGENS}`);
  }

  return fs
    .readdirSync(PASTA_IMAGENS)
    .filter((arquivo) => {
      const ext = path.extname(arquivo).toLowerCase();

      return [".jpg", ".jpeg", ".png", ".webp"].includes(ext);
    })
    .sort();
}

function normalizarTexto(texto) {
  if (!texto) return "";

  return texto
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .toLowerCase();
}

function limparLinhaParaRegex(linha) {
  if (!linha) return "";

  return linha
    .normalize("NFKC")
    .replace(/\s+/g, "")
    .replace(/[^\p{L}\p{N}]/gu, "");
}

function quebrarTextoEmLinhasUtilizaveis(textoCru) {
  if (!textoCru) return [];

  const linhasOriginais = textoCru.split(/\r?\n/);

  const linhas = linhasOriginais
    .map((linha) => ({
      original: linha,
      limpa: limparLinhaParaRegex(linha)
    }))
    .filter((linha) => linha.limpa);

  return linhas;
}

function encontrarCandidatosE2E(textoCru) {
  const linhas = quebrarTextoEmLinhasUtilizaveis(textoCru);
  const candidatos = [];

  for (let index = 0; index < linhas.length; index++) {
    const linhaAtual = linhas[index];

    const encontradosNaLinha = linhaAtual.limpa.match(E2E_REGEX) || [];

    for (const candidato of encontradosNaLinha) {
      candidatos.push({
        valor: candidato,
        origem: "linha",
        linha: index + 1,
        textoLinha: linhaAtual.original
      });
    }

    // Fallback controlado:
    // junta no máximo a linha atual com a próxima.
    // Isso ajuda quando o banco quebra o E2E em duas linhas,
    // mas evita juntar com várias informações do comprovante.
    const proximaLinha = linhas[index + 1];

    if (proximaLinha) {
      const duasLinhas = `${linhaAtual.limpa}${proximaLinha.limpa}`;
      const encontradosEmDuasLinhas = duasLinhas.match(E2E_REGEX) || [];

      for (const candidato of encontradosEmDuasLinhas) {
        candidatos.push({
          valor: candidato,
          origem: "duas-linhas",
          linha: index + 1,
          textoLinha: `${linhaAtual.original} ${proximaLinha.original}`
        });
      }
    }
  }

  const candidatosUnicos = new Map();

  for (const candidato of candidatos) {
    if (!candidatosUnicos.has(candidato.valor)) {
      candidatosUnicos.set(candidato.valor, candidato);
    }
  }

  return [...candidatosUnicos.values()];
}

function candidatoPareceE2E(candidato) {
  if (!candidato) return false;
  const comecaComEouD = candidato.startsWith("E") || candidato.startsWith("D");
  const tamanhoValido = candidato.length >= 29 && candidato.length <= 33;
  const formatoPix = /^[ED]\d{8}\d{8}[A-Za-z0-9]+$/.test(candidato);
  const temNumeros = /\d/.test(candidato);
  const temLetras = /[A-Za-z]/.test(candidato);

  return tamanhoValido && formatoPix && temNumeros && temLetras;
}

function calcularPontuacaoFormato(candidato) {
  let pontos = 0;

  if (candidato.length >= 29 && candidato.length <= 33) {
    pontos += 8;
  }

  if (/^[ED]\d{8}/.test(candidato)) {
  pontos += 8;
}

if (/^[ED]\d{8}\d{8}/.test(candidato)) {
  pontos += 8;
}
  return pontos;
}

function calcularPontuacaoContexto(textoCru, candidato, metadados) {
  const textoNormalizado = normalizarTexto(textoCru);
  const candidatoNormalizado = normalizarTexto(candidato);

  let pontos = 0;

  const indice = textoNormalizado.indexOf(candidatoNormalizado);

  if (indice !== -1) {
    const inicioJanela = Math.max(0, indice - 160);
    const fimJanela = Math.min(
      textoNormalizado.length,
      indice + candidatoNormalizado.length + 160
    );

    const janela = textoNormalizado.slice(inicioJanela, fimJanela);

    for (const palavra of PALAVRAS_CHAVE_E2E) {
      const palavraNormalizada = normalizarTexto(palavra);

      if (janela.includes(palavraNormalizada)) {
        pontos += 10;
      }
    }

    if (janela.includes("pix")) {
      pontos += 5;
    }

    if (janela.includes("transacao")) {
      pontos += 5;
    }

    if (janela.includes("comprovante")) {
      pontos += 3;
    }
  }

  if (metadados.origem === "linha") {
    pontos += 6;
  }

  if (metadados.origem === "duas-linhas") {
    pontos += 2;
  }

  pontos += calcularPontuacaoFormato(candidato);

  return pontos;
}

function extrairE2E(textoCru) {
  const candidatos = encontrarCandidatosE2E(textoCru)
    .filter((candidato) => candidatoPareceE2E(candidato.valor))
    .map((candidato) => ({
      valor: candidato.valor,
      pontuacao: calcularPontuacaoContexto(textoCru, candidato.valor, candidato),
      tamanho: candidato.valor.length,
      origem: candidato.origem,
      linha: candidato.linha,
      textoLinha: candidato.textoLinha
    }))
    .sort((a, b) => b.pontuacao - a.pontuacao);

  if (!candidatos.length) {
    return {
      e2e: null,
      metodo: "nenhum-candidato",
      candidatos: []
    };
  }

  const melhorCandidato = candidatos[0];

  if (melhorCandidato.pontuacao >= 20) {
    return {
      e2e: melhorCandidato.valor,
      metodo: "contexto",
      candidatos
    };
  }

  return {
    e2e: melhorCandidato.valor,
    metodo: "fallback-regex",
    candidatos
  };
}

function salvarTextoExtraido(arquivo, textoCru) {
  const nomeBase = path.parse(arquivo).name;
  const caminhoTexto = path.join(PASTA_TEXTOS_EXTRAIDOS, `${nomeBase}.txt`);

  fs.writeFileSync(caminhoTexto, textoCru || "", "utf8");

  return caminhoTexto;
}

async function testarGoogleVision(googleClient, caminhoImagem) {
  try {
    const [result] = await googleClient.textDetection(caminhoImagem);

    const textoCru = result.textAnnotations?.[0]?.description || "";
    const extracao = extrairE2E(textoCru);

    return {
      textoCru,
      e2e: extracao.e2e,
      metodo: extracao.metodo,
      candidatos: extracao.candidatos,
      erro: null
    };
  } catch (error) {
    return {
      textoCru: "",
      e2e: null,
      metodo: "erro-google-vision",
      candidatos: [],
      erro: error.message
    };
  }
}

async function rodarBenchmark() {
  garantirPastas();

  const googleClient = criarClienteGoogleVision();
  const arquivos = listarImagens();

  console.log(`Iniciando teste em ${arquivos.length} imagens...`);
  console.log("");

  let acertos = 0;
  let falhas = 0;
  let capturasPorContexto = 0;
  let capturasPorFallback = 0;

  const resultados = [];

  for (const arquivo of arquivos) {
    const caminhoCompleto = path.join(PASTA_IMAGENS, arquivo);
    const resultado = await testarGoogleVision(googleClient, caminhoCompleto);

    const caminhoTextoExtraido = salvarTextoExtraido(arquivo, resultado.textoCru);

    if (resultado.e2e) {
      acertos++;

      if (resultado.metodo === "contexto") {
        capturasPorContexto++;
      }

      if (resultado.metodo === "fallback-regex") {
        capturasPorFallback++;
      }

      console.log(`[OK] ${arquivo}`);
      console.log(`     E2E: ${resultado.e2e}`);
      console.log(`     Método: ${resultado.metodo}`);
    } else {
      falhas++;

      console.log(`[FALHA] ${arquivo}`);
      console.log(`        Método: ${resultado.metodo}`);

      if (resultado.erro) {
        console.log(`        Erro: ${resultado.erro}`);
      } else {
        console.log("        E2E não encontrado no texto extraído");
      }
    }

    resultados.push({
      arquivo,
      sucesso: Boolean(resultado.e2e),
      e2e: resultado.e2e,
      metodo: resultado.metodo,
      candidatos: resultado.candidatos,
      erro: resultado.erro,
      textoExtraidoPath: caminhoTextoExtraido
    });
  }

  const taxaAcerto = arquivos.length
    ? `${((acertos / arquivos.length) * 100).toFixed(2)}%`
    : "0.00%";

  const relatorio = {
    servico: "Google Cloud Vision",
    autenticacao: "Application Default Credentials",
    total: arquivos.length,
    acertos,
    falhas,
    taxaAcerto,
    capturasPorContexto,
    capturasPorFallback,
    regex: E2E_REGEX.toString(),
    geradoEm: new Date().toISOString(),
    resultados
  };

  fs.writeFileSync(CAMINHO_RELATORIO, JSON.stringify(relatorio, null, 2), "utf8");

  console.log("");
  console.log("--- RESULTADO FINAL ---");
  console.log(`Total: ${arquivos.length}`);
  console.log(`Acertos: ${acertos}`);
  console.log(`Falhas: ${falhas}`);
  console.log(`Taxa de acerto: ${taxaAcerto}`);
  console.log(`Capturas por contexto: ${capturasPorContexto}`);
  console.log(`Capturas por fallback-regex: ${capturasPorFallback}`);
  console.log(`Relatório salvo em: ${CAMINHO_RELATORIO}`);
  console.log(`Textos extraídos salvos em: ${PASTA_TEXTOS_EXTRAIDOS}`);

  if (capturasPorFallback > 0) {
    console.log("");
    console.log(
      "Atenção: revise os casos com método fallback-regex no relatório, pois são capturas menos confiáveis."
    );
  }
}

rodarBenchmark().catch((error) => {
  console.error("");
  console.error("Erro ao rodar benchmark:");
  console.error(error.message);
  process.exit(1);
});