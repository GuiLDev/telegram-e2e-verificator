/*
  Serviço responsável por gerar variações possíveis de um E2E.

  Objetivo:
  Quando a API da Bloo não encontra o E2E extraído pelo OCR/Gemini,
  este serviço gera candidatos alternativos para tentar recuperar o E2E correto.

  Camadas de candidatos:
  1. Ambiguidade visual:
     - 0 / o / O
     - 1 / l / I
     - 5 / s / S
     - 6 / s / S / G
     - 8 / B

  2. Recuperação estrutural:
     - casos onde o OCR mistura o botão "Copiar" com o E2E;
     - casos onde o último caractere do E2E aparece sozinho na linha de baixo.

  Importante:
  Este serviço NÃO decide qual E2E está correto.
  Ele apenas gera possibilidades.
  A decisão final vem da API da Bloo.
*/

const TAMANHO_E2E = 32;
const INDICE_INICIO_SUFIXO_E2E = 17;

const LIMITE_MAXIMO_CANDIDATOS = 128;
const LIMITE_MAXIMO_CARACTERES_AMBIGUOS = 5;

const E2E_EXATO_REGEX = /^[ED]\d{8}\d{8}[A-Za-z0-9]{15}$/;
const E2E_EXATO_GLOBAL_REGEX = /[ED]\d{8}\d{8}[A-Za-z0-9]{15}/g;

/*
  Mapa direcional de ambiguidades.

  Exemplo:
  Se o OCR leu "o", testamos também "0" e "O".
  Se o OCR leu "S", testamos também "5", "s" e "6".
*/
const MAPA_AMBIGUIDADES = {
  "0": ["0", "o", "O"],
  o: ["o", "0", "O"],
  O: ["O", "0", "o"],

  "1": ["1", "l", "I"],
  l: ["l", "1", "I"],
  I: ["I", "1", "l"],

  "5": ["5", "s", "S"],
  s: ["s", "5", "S", "6"],
  S: ["S", "5", "s", "6"],

  "6": ["6", "s", "S", "G"],
  G: ["G", "6"],

  "8": ["8", "B"],
  B: ["B", "8"]
};

function candidatoTemFormatoE2E(candidato) {
  return typeof candidato === "string" && E2E_EXATO_REGEX.test(candidato);
}

function adicionarCandidato(lista, candidato) {
  if (!candidatoTemFormatoE2E(candidato)) {
    return;
  }

  if (!lista.includes(candidato)) {
    lista.push(candidato);
  }
}

function limparLinhaParaCandidato(linha) {
  if (!linha) return "";

  return linha
    .normalize("NFKC")
    .replace(/\s+/g, "")
    .replace(/[^\p{L}\p{N}]/gu, "");
}

function removerRuidosDeAcao(linhaLimpa) {
  if (!linhaLimpa) return "";

  return linhaLimpa
    .replace(/copiar/gi, "")
    .replace(/copiado/gi, "")
    .replace(/copy/gi, "");
}

function obterVariacoesDoCaractere(caractere) {
  return MAPA_AMBIGUIDADES[caractere] || [caractere];
}

/*
  Encontra posições ambíguas somente no sufixo alfanumérico.

  Não mexemos na parte:
  E/D + 16 dígitos

  Motivo:
  A parte inicial tem muitos números e geraria candidatos demais.
  O sufixo é onde o OCR costuma confundir letras e números.
*/
function encontrarPosicoesAmbiguas(e2e) {
  const posicoes = [];

  for (let index = INDICE_INICIO_SUFIXO_E2E; index < e2e.length; index++) {
    const caractere = e2e[index];

    if (MAPA_AMBIGUIDADES[caractere]) {
      posicoes.push({
        index,
        caractere,
        variacoes: MAPA_AMBIGUIDADES[caractere]
      });
    }
  }

  return posicoes;
}

/*
  Gera candidatos por troca de caracteres ambíguos.

  Se houver ambiguidade demais, usamos apenas as últimas posições ambíguas,
  porque erros visuais no final do E2E são muito comuns em prints cortados.
*/
function gerarCandidatosPorAmbiguidade(e2e) {
  if (!candidatoTemFormatoE2E(e2e)) {
    return [];
  }

  const posicoesAmbiguas = encontrarPosicoesAmbiguas(e2e);

  if (!posicoesAmbiguas.length) {
    return [e2e];
  }

  const posicoesLimitadas = posicoesAmbiguas.slice(
    -LIMITE_MAXIMO_CARACTERES_AMBIGUOS
  );

  let candidatos = [e2e];

  for (const posicao of posicoesLimitadas) {
    const novosCandidatos = [];

    for (const candidatoAtual of candidatos) {
      for (const variacao of obterVariacoesDoCaractere(posicao.caractere)) {
        const caracteres = candidatoAtual.split("");
        caracteres[posicao.index] = variacao;

        novosCandidatos.push(caracteres.join(""));
      }
    }

    candidatos = [...new Set(novosCandidatos)];

    if (candidatos.length > LIMITE_MAXIMO_CANDIDATOS) {
      candidatos = candidatos.slice(0, LIMITE_MAXIMO_CANDIDATOS);
      break;
    }
  }

  return candidatos.filter(candidatoTemFormatoE2E);
}

/*
  Gera candidatos estruturais usando o texto bruto do OCR.

  Resolve casos como:

  E18236120202605191656s114822887 Copiar
  6

  O OCR pode capturar:
  E18236120202605191656s114822887C

  Mas o candidato estrutural correto pode ser:
  E18236120202605191656s1148228876
*/
function gerarCandidatosEstruturaisPorTexto(e2e, textoOCR) {
  const candidatos = [];

  if (!textoOCR || typeof textoOCR !== "string") {
    return candidatos;
  }

  if (!e2e || typeof e2e !== "string") {
    return candidatos;
  }

  const e2eNormalizado = e2e.trim();

  const linhas = textoOCR
    .split(/\r?\n/)
    .map((linha) => ({
      original: linha,
      limpa: limparLinhaParaCandidato(linha)
    }))
    .filter((linha) => linha.limpa);

  const prefixoForte = e2eNormalizado.slice(0, 20);

  for (let index = 0; index < linhas.length; index++) {
    const linhaAtual = linhas[index];

    const linhaSemRuido = removerRuidosDeAcao(linhaAtual.limpa);

    const linhaTemRuidoDeAcao = linhaAtual.limpa !== linhaSemRuido;

    const linhaRelacionadaAoE2E =
      linhaAtual.limpa.includes(e2eNormalizado) ||
      linhaAtual.limpa.includes(e2eNormalizado.slice(0, -1)) ||
      linhaSemRuido.includes(prefixoForte);

    if (!linhaTemRuidoDeAcao && !linhaRelacionadaAoE2E) {
      continue;
    }

    /*
      Olhamos até duas linhas abaixo.

      Isso cobre casos onde o último caractere ficou sozinho
      ou onde o OCR separou a continuação por quebra de linha.
    */
    for (let offset = 1; offset <= 2; offset++) {
      const proximaLinha = linhas[index + offset];

      if (!proximaLinha) {
        continue;
      }

      const complemento = proximaLinha.limpa;

      if (!/^[A-Za-z0-9]{1,3}$/.test(complemento)) {
        continue;
      }

      /*
        Estratégia 1:
        Remove "Copiar" da linha e junta com o complemento da linha seguinte.
      */
      const combinadoSemRuido = `${linhaSemRuido}${complemento}`;
      const encontrados = combinadoSemRuido.match(E2E_EXATO_GLOBAL_REGEX) || [];

      for (const encontrado of encontrados) {
        adicionarCandidato(candidatos, encontrado);
      }

      /*
        Estratégia 2:
        Se o OCR capturou 32 caracteres, mas o último veio do "Copiar",
        substituímos os últimos caracteres pelo complemento da linha seguinte.
      */
      if (e2eNormalizado.length === TAMANHO_E2E) {
        const candidatoPorSubstituicao =
          e2eNormalizado.slice(0, TAMANHO_E2E - complemento.length) +
          complemento;

        adicionarCandidato(candidatos, candidatoPorSubstituicao);
      }
    }
  }

  return candidatos;
}

/*
  Função principal.

  Retorna:
  1. E2E original primeiro;
  2. candidatos estruturais;
  3. candidatos por ambiguidade visual.

  A Bloo decide qual deles é válido.
*/
function gerarCandidatosE2E(e2e, opcoes = {}) {
  if (typeof e2e !== "string" || !e2e.trim()) {
    return [];
  }

  const e2eNormalizado = e2e.trim();

  if (!candidatoTemFormatoE2E(e2eNormalizado)) {
    return [e2eNormalizado];
  }

  const candidatos = [];

  adicionarCandidato(candidatos, e2eNormalizado);

  const candidatosEstruturais = gerarCandidatosEstruturaisPorTexto(
    e2eNormalizado,
    opcoes.textoOCR
  );

  for (const candidato of candidatosEstruturais) {
    adicionarCandidato(candidatos, candidato);
  }

  /*
    Também geramos variações ambíguas para o original
    e para os candidatos estruturais.
  */
  const basesParaAmbiguidade = [...candidatos];

  for (const base of basesParaAmbiguidade) {
    const variacoes = gerarCandidatosPorAmbiguidade(base);

    for (const variacao of variacoes) {
      adicionarCandidato(candidatos, variacao);

      if (candidatos.length >= LIMITE_MAXIMO_CANDIDATOS) {
        return candidatos;
      }
    }
  }

  return candidatos;
}

module.exports = {
  gerarCandidatosE2E,
  encontrarPosicoesAmbiguas,
  gerarCandidatosEstruturaisPorTexto
};