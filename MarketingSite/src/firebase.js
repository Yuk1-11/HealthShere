// firebase.js
import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey:"AIzaSyChyjKJffDpidR0VAlEayy5DBtIFFa4iYc",
  authDomain:"healthshere-b9f5d.firebaseapp.com",
  projectId:"healthshere-b9f5d",
  storageBucket:"healthshere-b9f5d.appspot.com",
  messagingSenderId:"1051446789284",
  appId:"1:1051446789284:web:1234567890abcdef"
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
