// Configuração do projeto Firebase "espetaria-cavalcante".
// A apiKey identifica o projeto; quem protege os dados são as regras do Firestore (firestore.rules).
const firebaseConfig = {
  apiKey: "AIzaSyAH8Wy6LkfzGFvN1-qOPMdNwkKh4IHKT0A",
  authDomain: "espetaria-cavalcante.firebaseapp.com",
  projectId: "espetaria-cavalcante",
  storageBucket: "espetaria-cavalcante.firebasestorage.app",
  messagingSenderId: "999788932070",
  appId: "1:999788932070:web:ff9982999fb8a33669c427"
};

// Identificador da loja dentro do banco (todos os dados ficam em /lojas/principal/...)
const LOJA_ID = "principal";