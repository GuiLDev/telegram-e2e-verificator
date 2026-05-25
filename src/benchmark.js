// Carrega as variáveis de ambiente do arquivo .env
require("dotenv").config();

// Módulos nativos do Node.js
// fs: manipulação de arquivos e pastas
// path: montagem segura de caminhos entre pastas
const fs = require("fs");
const path = require("path");

// SDK do Google Cloud Vision
// Usado para enviar imagens e receber o texto extraído por OCR
const vision = require("@google-cloud/vision");

// Caminho da pasta onde ficam as imagens dos comprovantes
const PASTA_IMAGENS = path.join(__dirname, "..", "comprovantes-teste");

// Caminho da pasta onde serão salvos os relatórios do benchmark
const PASTA_RELATORIOS = path.join(__dirname, "..", "relatorios");

// Caminho da pasta onde será salvo o texto bruto extraído de cada imagem
const PASTA_TEXTOS_EXTRAIDOS = path.join(PASTA_RELATORIOS, "textos-extraidos");

// Caminho do arquivo JSON final com o resultado completo do benchmark
const CAMINHO_RELATORIO = path.join(PASTA_RELATORIOS, "resultado-benchmark.json");

/*
  Regex principal para encontrar possíveis códigos E2E Pix.

  Formato esperado:
  - Começa com E ou D
    E = transação Pix comum
    D = devolução Pix

  - Depois vem 8 dígitos
    Geralmente representam o ISPB/instituição

  - Depois vem mais 8 dígitos
    Geralmente representam a data no formato YYYYMMDD

  - Depois vem uma sequência final alfanumérica
    Pode conter letras e números

  Exemplo:
  E0036030520260522130978144db424d
  D0036030520260522130978144db424d
*/
const E2E_REGEX = /[ED]\d{8}\d{8}[A-Za-z0-9]{11,16}/g;

/*
  Palavras-chave usadas para dar mais confiança a um candidato de E2E.

  A ideia é:
  se um código parecido com E2E aparecer perto de palavras como
  "idtransacao", "pix", "autenticacao" etc.,
  ele provavelmente é o E2E verdadeiro do comprovante.
*/
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

/*
  Garante que as pastas de relatório existem.

  Se a pasta relatorios/ não existir, cria.
  Se a pasta relatorios/textos-extraidos/ não existir, cria.

  Isso evita erro na hora de salvar os arquivos depois.
*/
function garantirPastas() {
  if (!fs.existsSync(PASTA_RELATORIOS)) {
    fs.mkdirSync(PASTA_RELATORIOS);
  }

  if (!fs.existsSync(PASTA_TEXTOS_EXTRAIDOS)) {
    fs.mkdirSync(PASTA_TEXTOS_EXTRAIDOS);
  }
}

/*
  Cria o cliente do Google Vision.

  Esse projeto está usando Application Default Credentials,
  ou seja, o login local feito pelo comando:

  gcloud auth application-default login

*/
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

/*
  Lista as imagens que serão processadas no benchmark.

  A função lê a pasta comprovantes-teste/
  e aceita somente arquivos com extensões de imagem comuns.
*/
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

/*
  Normaliza textos para comparação.

  Essa função é usada principalmente para comparar contexto,
  não para extrair diretamente o E2E.

  Ela faz:
  - remove acentos;
  - remove símbolos;
  - remove espaços;
  - transforma tudo em minúsculo.

  Exemplo:
  "ID da Transação Pix:"
  vira:
  "iddatransacaopix"
*/
function normalizarTexto(texto) {
  if (!texto) return "";

  return texto
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .toLowerCase();
}

/*
  Limpa uma linha específica para aplicação da Regex.

  Importante:
  Essa função limpa linha por linha, e não o comprovante inteiro.

  Isso evita o erro de juntar o E2E com a próxima informação do comprovante,
  por exemplo:

  E0036030520260522130978144db424d
  Instituição

  virar indevidamente:

  E0036030520260522130978144db424dInstituicao
*/
function limparLinhaParaRegex(linha) {
  if (!linha) return "";

  return linha
    .normalize("NFKC")
    .replace(/\s+/g, "")
    .replace(/[^\p{L}\p{N}]/gu, "");
}

/*
  Quebra o texto bruto retornado pelo OCR em linhas utilizáveis.

  Para cada linha, salvamos duas versões:

  original:
  linha como veio do Google Vision.

  limpa:
  linha preparada para aplicar Regex.
*/
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

/*
  Procura candidatos a E2E dentro do texto extraído.

  Essa função tenta encontrar E2E de duas formas:

  1. Na própria linha:
     quando o E2E aparece inteiro em uma linha.

  2. Juntando linha atual + próxima linha:
     usado como fallback controlado para casos onde o banco quebra o E2E
     em duas linhas.

  Importante:
  Ela não junta o comprovante inteiro.
  Junta no máximo duas linhas para evitar falso positivo.
*/
function encontrarCandidatosE2E(textoCru) {
  const linhas = quebrarTextoEmLinhasUtilizaveis(textoCru);
  const candidatos = [];

  for (let index = 0; index < linhas.length; index++) {
    const linhaAtual = linhas[index];

    // Primeiro tenta encontrar E2E diretamente na linha atual
    const encontradosNaLinha = linhaAtual.limpa.match(E2E_REGEX) || [];

    for (const candidato of encontradosNaLinha) {
      candidatos.push({
        valor: candidato,
        origem: "linha",
        linha: index + 1,
        textoLinha: linhaAtual.original
      });
    }

    /*
      Fallback controlado:

      Se o E2E foi quebrado em duas linhas pelo banco/OCR,
      juntamos a linha atual com a próxima linha.

      Exemplo:
      Linha 1: E0036030520260522
      Linha 2: 130978144db424d

      Resultado:
      E0036030520260522130978144db424d
    */
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

  /*
    Remove candidatos duplicados.

    Pode acontecer de o mesmo E2E ser encontrado:
    - na linha;
    - e também na junção de duas linhas.

    O Map garante que cada valor apareça uma vez só.
  */
  const candidatosUnicos = new Map();

  for (const candidato of candidatos) {
    if (!candidatosUnicos.has(candidato.valor)) {
      candidatosUnicos.set(candidato.valor, candidato);
    }
  }

  return [...candidatosUnicos.values()];
}

/*
  Valida se um candidato realmente parece ser um E2E Pix.

  Aqui não estamos escolhendo o melhor ainda.
  Só estamos removendo candidatos ruins.

  Critérios:
  - precisa existir;
  - precisa começar com E ou D;
  - precisa ter tamanho esperado;
  - precisa seguir o formato Pix;
  - precisa ter números;
  - precisa ter letras.
*/
function candidatoPareceE2E(candidato) {
  if (!candidato) return false;

  const comecaComEouD = candidato.startsWith("E") || candidato.startsWith("D");
  const tamanhoValido = candidato.length >= 29 && candidato.length <= 33;
  const formatoPix = /^[ED]\d{8}\d{8}[A-Za-z0-9]+$/.test(candidato);
  const temNumeros = /\d/.test(candidato);
  const temLetras = /[A-Za-z]/.test(candidato);

  return comecaComEouD && tamanhoValido && formatoPix && temNumeros && temLetras;
}

/*
  Calcula pontos baseados apenas no formato do candidato.

  Quanto mais o candidato parecer tecnicamente um E2E Pix,
  mais pontos ele recebe.
*/
function calcularPontuacaoFormato(candidato) {
  let pontos = 0;

  // Tamanho dentro da faixa esperada
  if (candidato.length >= 29 && candidato.length <= 33) {
    pontos += 8;
  }

  // Começa com E ou D + 8 dígitos
  if (/^[ED]\d{8}/.test(candidato)) {
    pontos += 8;
  }

  // Começa com E ou D + 16 dígitos
  if (/^[ED]\d{8}\d{8}/.test(candidato)) {
    pontos += 8;
  }

  return pontos;
}

/*
  Calcula a pontuação de confiança do candidato.

  Essa função olha:

  1. O contexto ao redor do candidato:
     se perto dele aparecem palavras como Pix, transacao, comprovante,
     identificador, autenticacao etc.

  2. A origem do candidato:
     se veio de uma linha única, ganha mais confiança.
     se veio da junção de duas linhas, ganha menos confiança.

  3. O formato:
     usa calcularPontuacaoFormato().
*/
function calcularPontuacaoContexto(textoCru, candidato, metadados) {
  const textoNormalizado = normalizarTexto(textoCru);
  const candidatoNormalizado = normalizarTexto(candidato);

  let pontos = 0;

  // Procura onde o candidato aparece no texto normalizado
  const indice = textoNormalizado.indexOf(candidatoNormalizado);

  if (indice !== -1) {
    /*
      Cria uma janela de contexto ao redor do E2E.

      Pegamos até 160 caracteres antes e 160 depois,
      para procurar palavras relevantes próximas ao candidato.
    */
    const inicioJanela = Math.max(0, indice - 160);
    const fimJanela = Math.min(
      textoNormalizado.length,
      indice + candidatoNormalizado.length + 160
    );

    const janela = textoNormalizado.slice(inicioJanela, fimJanela);

    // Cada palavra-chave encontrada perto do candidato aumenta bastante a confiança
    for (const palavra of PALAVRAS_CHAVE_E2E) {
      const palavraNormalizada = normalizarTexto(palavra);

      if (janela.includes(palavraNormalizada)) {
        pontos += 10;
      }
    }

    // Palavras extras que também ajudam a indicar contexto de comprovante Pix
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

  /*
    Candidato encontrado em uma única linha é mais confiável.

    Isso significa que o OCR encontrou o código inteiro sem precisar juntar
    com a próxima linha.
  */
  if (metadados.origem === "linha") {
    pontos += 6;
  }

  /*
    Candidato encontrado juntando duas linhas é útil,
    mas recebe menos pontos porque tem mais chance de falso positivo.
  */
  if (metadados.origem === "duas-linhas") {
    pontos += 2;
  }

  // Soma os pontos do formato técnico do E2E
  pontos += calcularPontuacaoFormato(candidato);

  return pontos;
}

/*
  Função principal da extração de E2E.

  Fluxo:
  1. encontra candidatos com Regex;
  2. remove candidatos inválidos;
  3. calcula pontuação de cada candidato;
  4. ordena do mais confiável para o menos confiável;
  5. retorna o melhor candidato.
*/
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

  /*
    Se nenhum candidato passou na Regex/validação,
    o script considera que não encontrou E2E.
  */
  if (!candidatos.length) {
    return {
      e2e: null,
      metodo: "nenhum-candidato",
      candidatos: []
    };
  }

  const melhorCandidato = candidatos[0];

  /*
    Se a pontuação for alta o suficiente,
    consideramos que o E2E foi encontrado por contexto.
  */
  if (melhorCandidato.pontuacao >= 20) {
    return {
      e2e: melhorCandidato.valor,
      metodo: "contexto",
      candidatos
    };
  }

  /*
    Se encontrou um candidato válido, mas sem contexto forte,
    retorna como fallback-regex.

    Esse caso deve ser revisado com mais atenção.
  */
  return {
    e2e: melhorCandidato.valor,
    metodo: "fallback-regex",
    candidatos
  };
}

/*
  Salva o texto bruto extraído pelo Google Vision.

  Isso ajuda muito na análise de falhas, porque permite ver exatamente
  o que o OCR leu em cada imagem.
*/
function salvarTextoExtraido(arquivo, textoCru) {
  const nomeBase = path.parse(arquivo).name;
  const caminhoTexto = path.join(PASTA_TEXTOS_EXTRAIDOS, `${nomeBase}.txt`);

  fs.writeFileSync(caminhoTexto, textoCru || "", "utf8");

  return caminhoTexto;
}

/*
  Envia uma imagem para o Google Vision e tenta extrair o E2E.

  Essa função:
  1. chama o OCR do Google Vision;
  2. pega o texto bruto extraído;
  3. chama extrairE2E();
  4. retorna o resultado organizado.
*/
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
    /*
      Se o Google Vision falhar por qualquer motivo,
      o erro é salvo para aparecer no relatório.
    */
    return {
      textoCru: "",
      e2e: null,
      metodo: "erro-google-vision",
      candidatos: [],
      erro: error.message
    };
  }
}

/*
  Função principal do benchmark.

  Ela processa todas as imagens da pasta comprovantes-teste/
  e gera um relatório final com acertos, falhas e candidatos encontrados.
*/
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

    // Envia a imagem para o Google Vision e tenta extrair o E2E
    const resultado = await testarGoogleVision(googleClient, caminhoCompleto);

    // Salva o texto bruto extraído para análise posterior
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

    /*
      Guarda o resultado individual de cada imagem.
      Esse array depois será salvo no resultado-benchmark.json.
    */
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

  // Calcula a porcentagem final de acertos
  const taxaAcerto = arquivos.length
    ? `${((acertos / arquivos.length) * 100).toFixed(2)}%`
    : "0.00%";

  /*
    Monta o relatório final do benchmark.
  */
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

  // Salva o relatório final em JSON
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

  /*
    Alerta quando houver capturas por fallback-regex.

    Esses casos merecem revisão porque o script encontrou algo que parece E2E,
    mas sem contexto forte o suficiente.
  */
  if (capturasPorFallback > 0) {
    console.log("");
    console.log(
      "Atenção: revise os casos com método fallback-regex no relatório, pois são capturas menos confiáveis."
    );
  }
}

/*
  Executa o benchmark.

  Se acontecer algum erro geral fora do fluxo normal,
  ele será exibido no terminal e o processo será encerrado com código 1.
*/
rodarBenchmark().catch((error) => {
  console.error("");
  console.error("Erro ao rodar benchmark:");
  console.error(error.message);
  process.exit(1);
});