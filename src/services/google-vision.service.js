/*
  Serviço responsável por integrar o projeto com o Google Cloud Vision.

  Responsabilidades:
  1. Criar o cliente do Google Vision usando o GOOGLE_CLOUD_PROJECT do .env.
  2. Usar a autenticação local do gcloud via Application Default Credentials.
  3. Enviar uma imagem para o OCR do Google Vision.
  4. Retornar somente o texto bruto extraído da imagem.

  Observação:
  Este serviço não sabe nada sobre E2E, Regex ou comprovante Pix.
  Ele apenas recebe uma imagem e devolve texto.
*/

const vision = require("@google-cloud/vision");

/*
  Cria o cliente do Google Vision.

  O projeto usa Application Default Credentials, então antes é necessário
  estar logado localmente com:

  gcloud auth application-default login

  Também é necessário ter GOOGLE_CLOUD_PROJECT definido no .env.
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
  Envia uma imagem para o Google Vision e retorna o texto bruto extraído.

  Entrada:
  - googleClient: cliente criado por criarClienteGoogleVision()
  - caminhoImagem: caminho local da imagem que será analisada

  Saída:
  - string com o texto extraído
  - string vazia caso o Google não retorne texto
*/
async function extrairTextoDaImagem(googleClient, caminhoImagem) {
  const [result] = await googleClient.textDetection(caminhoImagem);

  return result.textAnnotations?.[0]?.description || "";
}

module.exports = {
  criarClienteGoogleVision,
  extrairTextoDaImagem
};