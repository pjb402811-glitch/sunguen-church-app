import React, { useState, useEffect, createContext, useContext } from 'react';
import ReactDOM from 'react-dom/client';
import { initializeApp, type FirebaseApp } from '@firebase/app';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut, signInAnonymously, updatePassword, reauthenticateWithCredential, EmailAuthProvider, type Auth, type User } from '@firebase/auth';
import { getFirestore, collection, addDoc, updateDoc, deleteDoc, doc, serverTimestamp, query, onSnapshot, orderBy, type Firestore } from '@firebase/firestore';

// In a production environment, these would be managed via build-time environment variables.
// For this context, we declare them as potentially available globals set in index.html.
declare const __app_id: string;
declare const __firebase_config: string;
declare const __admin_user_id: string;
declare const __admin_email: string;

interface FirebaseContextType {
  app: FirebaseApp | null;
  db: Firestore | null;
  auth: Auth | null;
  user: User | null;
  userId: string | null;
  isAdmin: boolean;
  isAnonymous: boolean;
  isAuthReady: boolean;
  appId: string;
  logout: () => Promise<void>;
}

const FirebaseContext = createContext<FirebaseContextType | null>(null);

type FirebaseProviderProps = {
  children?: React.ReactNode;
};

function FirebaseProvider({ children }: FirebaseProviderProps) {
  const [app, setApp] = useState<FirebaseApp | null>(null);
  const [db, setDb] = useState<Firestore | null>(null);
  const [auth, setAuth] = useState<Auth | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isAnonymous, setIsAnonymous] = useState(true);
  const [isAuthReady, setIsAuthReady] = useState(false);

  const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';

  useEffect(() => {
    try {
      const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {};
      const adminId = typeof __admin_user_id !== 'undefined' ? __admin_user_id : null;

      if (!Object.keys(firebaseConfig).length || firebaseConfig.apiKey === "YOUR_API_KEY") {
        console.error("Firebase config is missing or using placeholder values.");
        setIsAuthReady(true);
        return;
      }
      
      const firebaseApp = initializeApp(firebaseConfig);
      const firestoreDb = getFirestore(firebaseApp);
      const firebaseAuth = getAuth(firebaseApp);

      setApp(firebaseApp);
      setDb(firestoreDb);
      setAuth(firebaseAuth);

      const unsubscribe = onAuthStateChanged(firebaseAuth, async (currentUser) => {
        if (currentUser) {
          setUser(currentUser);
          setUserId(currentUser.uid);
          setIsAnonymous(currentUser.isAnonymous);
          const isAdminUser = !!(adminId && currentUser.uid === adminId && adminId !== 'PASTE_YOUR_ADMIN_UID_HERE');
          setIsAdmin(isAdminUser);
        } else {
          setUser(null);
          setUserId(null);
          setIsAdmin(false);
          setIsAnonymous(true);
          try {
            await signInAnonymously(firebaseAuth);
          } catch (error) {
            console.error("Failed to sign in anonymously:", error);
          }
        }
        setIsAuthReady(true);
      });

      if (!firebaseAuth.currentUser) {
          signInAnonymously(firebaseAuth).catch(error => {
              console.error("Initial anonymous sign-in failed:", error);
          });
      }

      return () => unsubscribe();
    } catch (e) {
        console.error("Error initializing Firebase:", e);
        setIsAuthReady(true);
    }
  }, []);
  
  const logout = async () => {
    if (!auth) return;
    try {
      await signOut(auth);
    } catch (error) {
      console.error("Logout error:", error);
    }
  };

  const contextValue: FirebaseContextType = {
    app, db, auth, user, userId, isAdmin, isAnonymous, isAuthReady, appId, logout
  };

  return (
    <FirebaseContext.Provider value={contextValue}>
      {children}
    </FirebaseContext.Provider>
  );
}

function useFirebase() {
  const context = useContext(FirebaseContext);
  if (!context) {
    throw new Error('useFirebase must be used within a FirebaseProvider');
  }
  return context;
}

// Data types
interface Post {
  id: string;
  title: string;
  content: string;
  timestamp: any;
}

// Generic Content Display Component
function ContentDisplay({ collectionName, title }: { collectionName: string; title: string }) {
  const { db } = useFirebase();
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!db) return;
    setLoading(true);
    const q = query(collection(db, collectionName), orderBy('timestamp', 'desc'));
    const unsubscribe = onSnapshot(q, (querySnapshot) => {
      const postsData = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Post));
      setPosts(postsData);
      setLoading(false);
    }, (error) => {
      console.error(`Error fetching ${collectionName}:`, error);
      setLoading(false);
    });
    return () => unsubscribe();
  }, [db, collectionName]);

  return (
    <div className="p-4 md:p-6">
      <h2 className="text-2xl font-bold mb-4 text-gray-100">{title}</h2>
      {loading ? (
        <p className="text-gray-400">콘텐츠를 불러오는 중입니다...</p>
      ) : posts.length === 0 ? (
        <p className="text-gray-400">아직 등록된 게시물이 없습니다.</p>
      ) : (
        <div className="space-y-4">
          {posts.map((post) => (
            <div key={post.id} className="bg-gray-800 p-4 rounded-lg shadow">
              <h3 className="text-xl font-semibold text-teal-400 mb-2">{post.title}</h3>
              <p className="text-gray-300 whitespace-pre-wrap">{post.content}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Password Change Component (now used within AdminPanel)
function PasswordChange() {
    const { auth, user } = useFirebase();
    const [currentPassword, setCurrentPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [message, setMessage] = useState('');
    const [error, setError] = useState('');

    const handleChangePassword = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setMessage('');

        if (newPassword !== confirmPassword) {
            setError('새 비밀번호가 일치하지 않습니다.');
            return;
        }
        if (!auth || !user || !user.email) {
            setError('사용자 정보를 찾을 수 없습니다. 다시 로그인해주세요.');
            return;
        }

        try {
            const credential = EmailAuthProvider.credential(user.email, currentPassword);
            await reauthenticateWithCredential(user, credential);
            await updatePassword(user, newPassword);
            setMessage('비밀번호가 성공적으로 변경되었습니다.');
            setCurrentPassword('');
            setNewPassword('');
            setConfirmPassword('');
        } catch (err) {
            setError('비밀번호 변경에 실패했습니다. 현재 비밀번호를 확인해주세요.');
            console.error(err);
        }
    };
    
    return (
        <div className="p-4 md:p-6">
            <h3 className="text-xl font-semibold mb-4">비밀번호 변경</h3>
            <form onSubmit={handleChangePassword} className="space-y-4 max-w-md bg-gray-800 p-4 rounded-lg">
                <div>
                    <label htmlFor="current-password"className="block text-sm font-medium text-gray-400">현재 비밀번호</label>
                    <input id="current-password" type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} required className="mt-1 block w-full bg-gray-700 border border-gray-600 rounded-md py-2 px-3 text-white focus:outline-none focus:ring-teal-500 focus:border-teal-500" />
                </div>
                <div>
                    <label htmlFor="new-password"className="block text-sm font-medium text-gray-400">새 비밀번호</label>
                    <input id="new-password" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required className="mt-1 block w-full bg-gray-700 border border-gray-600 rounded-md py-2 px-3 text-white focus:outline-none focus:ring-teal-500 focus:border-teal-500" />
                </div>
                <div>
                    <label htmlFor="confirm-password"className="block text-sm font-medium text-gray-400">새 비밀번호 확인</label>
                    <input id="confirm-password" type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required className="mt-1 block w-full bg-gray-700 border border-gray-600 rounded-md py-2 px-3 text-white focus:outline-none focus:ring-teal-500 focus:border-teal-500" />
                </div>
                {error && <p className="text-red-400 text-sm">{error}</p>}
                {message && <p className="text-green-400 text-sm">{message}</p>}
                <button type="submit" className="w-full bg-teal-600 hover:bg-teal-700 text-white font-bold py-2 px-4 rounded-md transition duration-300">
                    비밀번호 변경
                </button>
            </form>
        </div>
    );
}

// Content Management Component (now used within AdminPanel)
function ContentManagement() {
  const { db } = useFirebase();
  const [activeAdminTab, setActiveAdminTab] = useState('sermons');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [posts, setPosts] = useState<Post[]>([]);
  const [editingPost, setEditingPost] = useState<Post | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<Post | null>(null);

  useEffect(() => {
    if (!db) return;
    const q = query(collection(db, activeAdminTab), orderBy('timestamp', 'desc'));
    const unsubscribe = onSnapshot(q, (querySnapshot) => {
      const postsData = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Post));
      setPosts(postsData);
    });
    return () => unsubscribe();
  }, [db, activeAdminTab]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!db || !title.trim() || !content.trim()) return;

    try {
      if (editingPost) {
        const postRef = doc(db, activeAdminTab, editingPost.id);
        await updateDoc(postRef, { title, content });
        setEditingPost(null);
      } else {
        await addDoc(collection(db, activeAdminTab), {
          title, content, timestamp: serverTimestamp(),
        });
      }
      setTitle('');
      setContent('');
    } catch (error) {
      console.error("Error saving document: ", error);
    }
  };

  const startEdit = (post: Post) => {
    setEditingPost(post);
    setTitle(post.title);
    setContent(post.content);
    window.scrollTo(0, 0);
  };
  
  const cancelEdit = () => {
    setEditingPost(null);
    setTitle('');
    setContent('');
  };

  const deletePost = async (id: string) => {
    if (!db) return;
    try {
      await deleteDoc(doc(db, activeAdminTab, id));
      setShowDeleteConfirm(null);
    } catch (error) {
      console.error("Error deleting document: ", error);
    }
  };
  
  const contentTabs = [
    { id: 'sermons', label: '예배말씀' },
    { id: 'columns', label: '목회칼럼' },
    { id: 'announcements', label: '공지사항' },
  ];

  return (
    <div className="p-4 md:p-6">
       <div className="mb-4 border-b border-gray-700">
        <nav className="-mb-px flex space-x-4" aria-label="Tabs">
          {contentTabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => { setActiveAdminTab(tab.id); cancelEdit(); }}
              className={`${
                activeAdminTab === tab.id
                  ? 'border-teal-400 text-teal-400'
                  : 'border-transparent text-gray-400 hover:text-gray-200 hover:border-gray-500'
              } whitespace-nowrap py-3 px-1 border-b-2 font-medium text-sm transition-colors`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      <form onSubmit={handleSubmit} className="mb-8 bg-gray-800 p-4 rounded-lg">
        <h3 className="text-xl font-semibold mb-4">{editingPost ? '게시물 수정' : '새 게시물 작성'}</h3>
        <div className="space-y-4">
          <input type="text" placeholder="제목" value={title} onChange={(e) => setTitle(e.target.value)} className="w-full bg-gray-700 border border-gray-600 rounded-md py-2 px-3 text-white focus:outline-none focus:ring-teal-500 focus:border-teal-500" required />
          <textarea placeholder="내용" value={content} onChange={(e) => setContent(e.target.value)} className="w-full bg-gray-700 border border-gray-600 rounded-md py-2 px-3 text-white focus:outline-none focus:ring-teal-500 focus:border-teal-500" rows={8} required />
        </div>
        <div className="mt-4 flex items-center space-x-2">
          <button type="submit" className="bg-teal-600 hover:bg-teal-700 text-white font-bold py-2 px-4 rounded-md transition duration-300">
            {editingPost ? '수정 완료' : '게시물 등록'}
          </button>
          {editingPost && (
            <button type="button" onClick={cancelEdit} className="bg-gray-600 hover:bg-gray-700 text-white font-bold py-2 px-4 rounded-md transition duration-300">
              취소
            </button>
          )}
        </div>
      </form>

      <div className="space-y-4">
        {posts.map(post => (
          <div key={post.id} className="bg-gray-800 p-4 rounded-lg flex justify-between items-start">
            <div>
              <h3 className="text-xl font-semibold text-teal-400 mb-2">{post.title}</h3>
              <p className="text-gray-300 whitespace-pre-wrap">{post.content}</p>
            </div>
            <div className="flex space-x-2 flex-shrink-0 ml-4">
              <button onClick={() => startEdit(post)} className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold py-1 px-3 rounded-md transition">수정</button>
              <button onClick={() => setShowDeleteConfirm(post)} className="bg-red-600 hover:bg-red-700 text-white text-sm font-bold py-1 px-3 rounded-md transition">삭제</button>
            </div>
          </div>
        ))}
      </div>
      
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50">
          <div className="bg-gray-800 rounded-lg p-6 max-w-sm w-full mx-4">
            <h3 className="text-lg font-bold text-white">삭제 확인</h3>
            <p className="text-gray-300 mt-2 mb-4">"{showDeleteConfirm.title}" 게시물을 정말로 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.</p>
            <div className="flex justify-end space-x-2">
              <button onClick={() => setShowDeleteConfirm(null)} className="bg-gray-600 hover:bg-gray-700 text-white font-bold py-2 px-4 rounded-md">취소</button>
              <button onClick={() => deletePost(showDeleteConfirm.id)} className="bg-red-600 hover:bg-red-700 text-white font-bold py-2 px-4 rounded-md">삭제</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


// Admin Panel Component
function AdminPanel() {
  const { auth, logout, isAdmin } = useFirebase();
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [adminSubTab, setAdminSubTab] = useState('content');

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!auth) return;
    setError('');
    try {
      const adminEmail = typeof __admin_email !== 'undefined' ? __admin_email : '';
      if (!adminEmail || adminEmail === 'PASTE_YOUR_ADMIN_EMAIL_HERE') {
        setError('관리자 이메일이 설정되지 않았습니다.');
        return;
      }
      await signInWithEmailAndPassword(auth, adminEmail, password);
    } catch (err) {
      setError('로그인에 실패했습니다. 비밀번호를 확인해주세요.');
      console.error(err);
    }
  };

  if (!isAdmin) {
    return (
      <div className="p-4 md:p-6 max-w-md mx-auto">
        <h2 className="text-2xl font-bold mb-4 text-center">관리자 로그인</h2>
        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label htmlFor="password" className="block text-sm font-medium text-gray-400">비밀번호</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 block w-full bg-gray-700 border border-gray-600 rounded-md shadow-sm py-2 px-3 text-white focus:outline-none focus:ring-teal-500 focus:border-teal-500"
              required
            />
          </div>
          {error && <p className="text-red-400 text-sm">{error}</p>}
          <button type="submit" className="w-full bg-teal-600 hover:bg-teal-700 text-white font-bold py-2 px-4 rounded-md transition duration-300">
            로그인
          </button>
        </form>
      </div>
    );
  }
  
  const adminPageTabs = [
      { id: 'content', label: '콘텐츠 관리' },
      { id: 'password', label: '비밀번호 변경' },
  ];

  return (
    <div className="p-4 md:p-6">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold">관리자 페이지</h2>
        <button onClick={logout} className="bg-red-600 hover:bg-red-700 text-white font-bold py-2 px-4 rounded-md transition duration-300">
          로그아웃
        </button>
      </div>
      
       <div className="mb-4 border-b border-gray-700">
        <nav className="-mb-px flex space-x-4" aria-label="Tabs">
          {adminPageTabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setAdminSubTab(tab.id)}
              className={`${
                adminSubTab === tab.id
                  ? 'border-teal-400 text-teal-400'
                  : 'border-transparent text-gray-400 hover:text-gray-200 hover:border-gray-500'
              } whitespace-nowrap py-3 px-1 border-b-2 font-medium text-sm transition-colors`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {adminSubTab === 'content' && <ContentManagement />}
      {adminSubTab === 'password' && <PasswordChange />}
    </div>
  );
}

// App Component
function App() {
  const [activeTab, setActiveTab] = useState('sermons');
  const { isAuthReady } = useFirebase();

  const tabColorClasses: { [key: string]: string } = {
    sermons: 'bg-sky-600 hover:bg-sky-500',
    columns: 'bg-emerald-600 hover:bg-emerald-500',
    announcements: 'bg-orange-600 hover:bg-orange-500',
    admin: 'bg-rose-600 hover:bg-rose-500',
  };

  if (!isAuthReady) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-900">
        <div className="text-white text-xl">앱을 불러오는 중입니다...</div>
      </div>
    );
  }
  
  const tabs = [
    { id: 'sermons', label: '예배말씀' },
    { id: 'columns', label: '목회칼럼' },
    { id: 'announcements', label: '공지사항' },
    { id: 'admin', label: '관리자' },
  ];

  return (
    <div className="min-h-screen flex flex-col bg-gray-900">
      <header className="bg-gray-800 p-4 text-center shadow-lg">
        <h1 className="text-2xl font-bold text-white">
          성은감리교회
          <span className="block text-xs text-gray-400 font-normal mt-1">(영혼을 구원하여 제자삼는 가정교회)</span>
        </h1>
      </header>

      <nav className="bg-gray-800 sticky top-0 z-10 shadow">
        <div className="max-w-7xl mx-auto px-2 sm:px-6 lg:px-8">
          <div className="relative flex items-center justify-center h-16">
            <div className="flex items-center justify-center sm:items-stretch sm:justify-start">
              <div className="flex space-x-2">
                {tabs.map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`${
                      tabColorClasses[tab.id] || 'bg-gray-700 hover:bg-gray-600'
                    } ${
                      activeTab === tab.id
                        ? 'text-white ring-2 ring-offset-2 ring-offset-gray-800 ring-white'
                        : 'text-gray-200 opacity-80 hover:opacity-100'
                    } px-3 py-2 rounded-md text-sm font-medium transition-all duration-200`}
                    aria-current={activeTab === tab.id ? 'page' : undefined}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </nav>

      <main className="flex-grow container mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {activeTab === 'sermons' && <ContentDisplay collectionName="sermons" title="예배말씀" />}
        {activeTab === 'columns' && <ContentDisplay collectionName="columns" title="목회칼럼" />}
        {activeTab === 'announcements' && <ContentDisplay collectionName="announcements" title="공지사항" />}
        {activeTab === 'admin' && <AdminPanel />}
      </main>
    </div>
  );
}

const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement);
root.render(
  <React.StrictMode>
    <FirebaseProvider>
      <App />
    </FirebaseProvider>
  </React.StrictMode>
);