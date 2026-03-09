import React, { useState, useEffect } from "react";
import {
  User,
  Wallet,
  Lock,
  Mail,
  Save,
  Loader2,
  CheckCircle,
  AlertCircle,
  Send,
  Gift,
  Copy,
  Shield,
  Users,
  BarChart3,
  MessageSquare,
  Package,
  Settings as SettingsIcon,
  Search,
  Trash2,
  Edit,
  Eye,
  X,
  FileText,
} from "lucide-react";
import { useSearchParams } from "react-router-dom";
import api from "../services/api";
import useAuthStore from "../store/useAuthStore";

// Tab 配置
const TABS = [
  { key: "mystats", label: "我的数据", icon: BarChart3 },
  { key: "account", label: "账户安全", icon: User },
  { key: "billing", label: "财务与额度", icon: Wallet },
  { key: "token", label: "兑换额度", icon: Gift },
  { key: "feedback", label: "意见反馈", icon: MessageSquare },
];

// 管理员专属 tab（管理员中心显示）
const ADMIN_ONLY_TABS = [
  { key: "users", label: "用户管理", icon: Users },
  { key: "tasks", label: "分析记录", icon: FileText },
  { key: "stats", label: "数据统计", icon: BarChart3 },
  { key: "admin_feedback", label: "反馈管理", icon: MessageSquare },
  { key: "packages", label: "套餐配置", icon: Package },
  { key: "site_content", label: "内容管理", icon: Edit },
  { key: "settings", label: "系统设置", icon: SettingsIcon },
  { key: "admin", label: "兑换码管理", icon: Shield },
];

const ADMIN_TABS = [
  ...ADMIN_ONLY_TABS,
  ...TABS,
];

export default function SettingsPage({ adminMode = false }) {
  const [searchParams] = useSearchParams();
  const initialTab = searchParams.get("tab") || (adminMode ? "users" : "account");
  const [activeTab, setActiveTab] = useState(initialTab);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);

  // 账户安全状态
  const [profile, setProfile] = useState(null);
  const [email, setEmail] = useState("");
  const [emailCode, setEmailCode] = useState("");
  const [sendingEmailCode, setSendingEmailCode] = useState(false);
  const [emailCountdown, setEmailCountdown] = useState(0);

  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  // 财务额度状态
  const [orders, setOrders] = useState([]);
  const [usage, setUsage] = useState([]);

  // Token 状态
  const [redeemToken, setRedeemToken] = useState("");
  const [redeeming, setRedeeming] = useState(false);
  const [generatedToken, setGeneratedToken] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [tokenQuota, setTokenQuota] = useState(10);

  // 管理员状态
  const [adminTokens, setAdminTokens] = useState([]);
  const [adminAvailable, setAdminAvailable] = useState(0);
  const [tokenCount, setTokenCount] = useState(1);

  // 用户管理状态
  const [users, setUsers] = useState([]);
  const [usersTotal, setUsersTotal] = useState(0);
  const [userPage, setUserPage] = useState(1);
  const [userSearch, setUserSearch] = useState("");
  const [userStatus, setUserStatus] = useState("");
  const [selectedUser, setSelectedUser] = useState(null);

  // 数据统计状态
  const [stats, setStats] = useState(null);
  const [myStats, setMyStats] = useState(null);

  // 反馈状态
  const [myFeedback, setMyFeedback] = useState([]);
  const [feedbackList, setFeedbackList] = useState([]);
  const [feedbackTotal, setFeedbackTotal] = useState(0);
  const [feedbackPage, setFeedbackPage] = useState(1);
  const [feedbackStatus, setFeedbackStatus] = useState("");
  const [feedbackReply, setFeedbackReply] = useState("");
  const [showReplyModal, setShowReplyModal] = useState(null);

  // 用户反馈表单
  const [feedbackForm, setFeedbackForm] = useState({ type: "suggestion", title: "", content: "" });
  const [submittingFeedback, setSubmittingFeedback] = useState(false);

  // 套餐状态
  const [packages, setPackages] = useState([]);

  // 系统设置状态
  const [systemSettings, setSystemSettings] = useState({});

  // 分析记录状态
  const [tasks, setTasks] = useState([]);
  const [tasksTotal, setTasksTotal] = useState(0);
  const [taskPage, setTaskPage] = useState(1);
  const [taskStatus, setTaskStatus] = useState("");
  const [taskSearch, setTaskSearch] = useState("");
  const [selectedTask, setSelectedTask] = useState(null);

  const setQuota = useAuthStore((s) => s.setQuota);

  // 加载用户信息和角色
  useEffect(() => {
    async function loadProfile() {
      try {
        const [profileData, roleData] = await Promise.all([
          api.get("/api/user/profile"),
          api.get("/api/token/role"),
        ]);
        setProfile(profileData);
        setEmail(profileData.email || "");
        setIsAdmin(roleData.isAdmin || false);
      } catch (err) {
        console.error("加载用户信息失败:", err);
      }
    }
    loadProfile();
  }, []);

  // 加载数据
  useEffect(() => {
    // 加载我的数据看板
    if (activeTab === "mystats") {
      async function loadMyStats() {
        try {
          const data = await api.get("/api/user/stats");
          setMyStats(data);
        } catch (err) {
          console.error("加载个人数据失败:", err);
        }
      }
      loadMyStats();
    }

    // 加载订单和消费记录
    if (activeTab === "billing") {
      async function loadBilling() {
        try {
          const [ordersData, usageData] = await Promise.all([
            api.get("/api/user/orders"),
            api.get("/api/user/usage"),
          ]);
          setOrders(ordersData || []);
          setUsage(usageData || []);
        } catch (err) {
          console.error("加载账单失败:", err);
        }
      }
      loadBilling();
    }

    // 加载管理员数据
    if (activeTab === "admin" && isAdmin) {
      async function loadAdminData() {
        try {
          const data = await api.get("/api/token/list");
          setAdminTokens(data.tokens || []);
          setAdminAvailable(data.available || 0);
        } catch (err) {
          console.error("加载管理员数据失败:", err);
        }
      }
      loadAdminData();
    }

    // 加载用户列表
    if (activeTab === "users" && isAdmin) {
      loadUsers();
    }

    // 加载统计数据
    if (activeTab === "stats" && isAdmin) {
      async function loadStats() {
        try {
          const data = await api.get("/api/admin/stats");
          setStats(data);
        } catch (err) {
          console.error("加载统计数据失败:", err);
        }
      }
      loadStats();
    }

    // 加载我的反馈
    if (activeTab === "feedback") {
      async function loadMyFeedback() {
        try {
          const data = await api.get("/api/feedback/my");
          setMyFeedback(data.feedback || []);
        } catch (err) {
          console.error("加载反馈失败:", err);
        }
      }
      loadMyFeedback();
    }

    // 加载反馈列表（管理员）
    if (activeTab === "admin_feedback" && isAdmin) {
      loadFeedbackList();
    }

    // 加载套餐列表
    if (activeTab === "packages" && isAdmin) {
      async function loadPackages() {
        try {
          const data = await api.get("/api/admin/packages");
          setPackages(data.packages || []);
        } catch (err) {
          console.error("加载套餐失败:", err);
        }
      }
      loadPackages();
    }

    // 加载系统设置
    if (activeTab === "settings" && isAdmin) {
      async function loadSettings() {
        try {
          const data = await api.get("/api/admin/settings");
          setSystemSettings(data.settings || {});
        } catch (err) {
          console.error("加载设置失败:", err);
        }
      }
      loadSettings();
    }

    // 加载分析记录
    if (activeTab === "tasks" && isAdmin) {
      loadTasks();
    }
  }, [activeTab, isAdmin, userPage, userSearch, userStatus, feedbackPage, feedbackStatus, taskPage, taskStatus, taskSearch]);

  const loadUsers = async () => {
    try {
      const data = await api.get(`/api/admin/users?page=${userPage}&pageSize=20&search=${userSearch}&status=${userStatus}`);
      setUsers(data.users || []);
      setUsersTotal(data.total || 0);
    } catch (err) {
      console.error("加载用户失败:", err);
    }
  };

  const loadFeedbackList = async () => {
    try {
      const data = await api.get(`/api/admin/feedback?page=${feedbackPage}&pageSize=20&status=${feedbackStatus}`);
      setFeedbackList(data.feedback || []);
      setFeedbackTotal(data.total || 0);
    } catch (err) {
      console.error("加载反馈失败:", err);
    }
  };

  const loadTasks = async () => {
    try {
      const data = await api.get(`/api/admin/tasks?page=${taskPage}&pageSize=20&status=${taskStatus}&search=${taskSearch}`);
      setTasks(data.tasks || []);
      setTasksTotal(data.total || 0);
    } catch (err) {
      console.error("加载分析记录失败:", err);
    }
  };

  // 发送邮箱验证码
  const handleSendEmailCode = async () => {
    if (!email || !email.includes("@")) {
      setMessage({ type: "error", text: "请输入正确的邮箱" });
      return;
    }

    setSendingEmailCode(true);
    setMessage(null);
    try {
      await api.post("/api/verify/send", { email });
      setMessage({ type: "success", text: "验证码已发送到邮箱" });
      setEmailCountdown(60);
      const timer = setInterval(() => {
        setEmailCountdown((prev) => {
          if (prev <= 1) {
            clearInterval(timer);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    } catch (err) {
      setMessage({ type: "error", text: err.message || "发送失败" });
    } finally {
      setSendingEmailCode(false);
    }
  };

  // 绑定邮箱
  const handleBindEmail = async () => {
    if (!emailCode) {
      setMessage({ type: "error", text: "请输入验证码" });
      return;
    }

    setLoading(true);
    setMessage(null);
    try {
      await api.post("/api/verify/check", { email, code: emailCode });
      await api.post("/api/auth/bind-contact", { email });
      setMessage({ type: "success", text: "邮箱绑定成功" });
      setEmailCode("");
      const data = await api.get("/api/user/profile");
      setProfile(data);
    } catch (err) {
      setMessage({ type: "error", text: err.message || "绑定失败" });
    } finally {
      setLoading(false);
    }
  };

  // 生成兑换码
  const handleGenerateToken = async () => {
    setGenerating(true);
    setMessage(null);
    try {
      const result = await api.post("/api/token/generate", {
        quotaAmount: tokenQuota,
        expireDays: 30
      });
      setGeneratedToken(result);
      setMessage({ type: "success", text: "兑换码生成成功" });
    } catch (err) {
      setMessage({ type: "error", text: err.message || "生成失败" });
    } finally {
      setGenerating(false);
    }
  };

  // 兑换
  const handleRedeemToken = async () => {
    if (!redeemToken) {
      setMessage({ type: "error", text: "请输入兑换码" });
      return;
    }

    setRedeeming(true);
    setMessage(null);
    try {
      const result = await api.post("/api/token/redeem", { token: redeemToken });
      setMessage({ type: "success", text: result.message });
      setRedeemToken("");
      const data = await api.get("/api/quota");
      setQuota(data);
    } catch (err) {
      setMessage({ type: "error", text: err.message || "兑换失败" });
    } finally {
      setRedeeming(false);
    }
  };

  // 复制兑换码
  const copyToken = async () => {
    if (generatedToken?.token) {
      try {
        await navigator.clipboard.writeText(generatedToken.token);
        setMessage({ type: "success", text: "已复制到剪贴板" });
      } catch (err) {
        // 降级方案
        const textArea = document.createElement("textarea");
        textArea.value = generatedToken.token;
        textArea.style.position = "fixed";
        textArea.style.left = "-999999px";
        document.body.appendChild(textArea);
        textArea.select();
        try {
          document.execCommand("copy");
          setMessage({ type: "success", text: "已复制到剪贴板" });
        } catch (e) {
          setMessage({ type: "error", text: "复制失败" });
        }
        document.body.removeChild(textArea);
      }
    }
  };

  // 提交反馈
  const handleSubmitFeedback = async () => {
    if (!feedbackForm.title || !feedbackForm.content) {
      setMessage({ type: "error", text: "请填写标题和内容" });
      return;
    }
    setSubmittingFeedback(true);
    setMessage(null);
    try {
      await api.post("/api/feedback", feedbackForm);
      setMessage({ type: "success", text: "反馈提交成功" });
      setFeedbackForm({ type: "suggestion", title: "", content: "" });
      const data = await api.get("/api/feedback/my");
      setMyFeedback(data.feedback || []);
    } catch (err) {
      setMessage({ type: "error", text: err.message || "提交失败" });
    } finally {
      setSubmittingFeedback(false);
    }
  };

  // 渲染消息
  const renderMessage = () => {
    if (!message) return null;
    return (
      <div className={`flex items-center gap-2 p-3 rounded-lg mb-4 ${
        message.type === "success" ? "bg-green-500/10 text-green-400 border border-green-500/20" : "bg-red-500/10 text-red-400 border border-red-500/20"
      }`}>
        {message.type === "success" ? <CheckCircle className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
        {message.text}
      </div>
    );
  };

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold mb-6">
        {adminMode ? "管理员中心" : "用户中心"}
        {!adminMode && isAdmin && <span className="text-xs bg-yellow-500/20 text-yellow-400 px-2 py-0.5 rounded ml-2">管理员</span>}
      </h1>

      {/* Tab 切换 */}
      <div className="flex gap-2 mb-6 border-b border-white/10 pb-4 overflow-x-auto">
        {(adminMode ? ADMIN_ONLY_TABS : isAdmin ? ADMIN_TABS : TABS).map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors whitespace-nowrap ${
              activeTab === tab.key ? "bg-blue-600 text-white" : "text-slate-400 hover:text-white hover:bg-slate-800"
            }`}
          >
            <tab.icon className="w-4 h-4" />
            {tab.label}
          </button>
        ))}
      </div>

      {renderMessage()}

      {/* 我的数据 Tab */}
      {activeTab === "mystats" && <MyStatsTab stats={myStats} />}

      {/* 账户安全 Tab */}
      {activeTab === "account" && (
        <AccountTab
          profile={profile} email={email} setEmail={setEmail} emailCode={emailCode} setEmailCode={setEmailCode}
          sendingEmailCode={sendingEmailCode} emailCountdown={emailCountdown}
          handleSendEmailCode={handleSendEmailCode} handleBindEmail={handleBindEmail}
          oldPassword={oldPassword} setOldPassword={setOldPassword}
          newPassword={newPassword} setNewPassword={setNewPassword}
          confirmPassword={confirmPassword} setConfirmPassword={setConfirmPassword}
          loading={loading} setMessage={setMessage}
        />
      )}

      {/* 财务与额度 Tab */}
      {activeTab === "billing" && <BillingTab profile={profile} orders={orders} usage={usage} />}

      {/* 意见反馈 Tab */}
      {activeTab === "feedback" && (
        <FeedbackTab
          feedback={myFeedback} feedbackForm={feedbackForm} setFeedbackForm={setFeedbackForm}
          submitting={submittingFeedback} handleSubmit={handleSubmitFeedback}
        />
      )}

      {/* 兑换码 Tab */}
      {activeTab === "token" && (
        <TokenTab
          redeemToken={redeemToken} setRedeemToken={setRedeemToken}
          redeeming={redeeming} handleRedeem={handleRedeemToken}
          generatedToken={generatedToken} generating={generating}
          tokenQuota={tokenQuota} setTokenQuota={setTokenQuota}
          handleGenerate={handleGenerateToken} copyToken={copyToken}
          isAdmin={isAdmin}
        />
      )}

      {/* 用户管理 Tab (管理员) */}
      {activeTab === "users" && isAdmin && (
        <UsersTab
          users={users} total={usersTotal} page={userPage} setPage={setUserPage}
          search={userSearch} setSearch={setUserSearch} status={userStatus} setStatus={setUserStatus}
          loadUsers={loadUsers} setSelectedUser={setSelectedUser} selectedUser={selectedUser}
          loading={loading} setLoading={setLoading} setMessage={setMessage}
        />
      )}

      {/* 分析记录 Tab (管理员) */}
      {activeTab === "tasks" && isAdmin && (
        <TasksTab
          tasks={tasks} total={tasksTotal} page={taskPage} setPage={setTaskPage}
          status={taskStatus} setStatus={setTaskStatus}
          search={taskSearch} setSearch={setTaskSearch}
          loadTasks={loadTasks}
          selectedTask={selectedTask} setSelectedTask={setSelectedTask}
        />
      )}

      {/* 数据统计 Tab (管理员) */}
      {activeTab === "stats" && isAdmin && <StatsTab stats={stats} />}

      {/* 反馈管理 Tab (管理员) */}
      {activeTab === "admin_feedback" && isAdmin && (
        <AdminFeedbackTab
          feedback={feedbackList} total={feedbackTotal} page={feedbackPage} setPage={setFeedbackPage}
          status={feedbackStatus} setStatus={setFeedbackStatus} loadFeedback={loadFeedbackList}
          reply={feedbackReply} setReply={setFeedbackReply}
          showModal={showReplyModal} setShowModal={setShowReplyModal}
        />
      )}

      {/* 套餐配置 Tab (管理员) */}
      {activeTab === "packages" && isAdmin && (
        <PackagesTab packages={packages} setPackages={setPackages} setMessage={setMessage} />
      )}

      {/* 内容管理 Tab (管理员) */}
      {activeTab === "site_content" && isAdmin && (
        <SiteContentTab setMessage={setMessage} />
      )}

      {/* 系统设置 Tab (管理员) */}
      {activeTab === "settings" && isAdmin && (
        <SystemSettingsTab settings={systemSettings} setSettings={setSystemSettings} setMessage={setMessage} />
      )}

      {/* 管理员面板 Tab */}
      {activeTab === "admin" && isAdmin && (
        <AdminPanel
          tokenQuota={tokenQuota} setTokenQuota={setTokenQuota}
          tokenCount={tokenCount} setTokenCount={setTokenCount}
          generating={generating} setGenerating={setGenerating}
          setGeneratedToken={setGeneratedToken} setMessage={setMessage}
          adminTokens={adminTokens} setAdminTokens={setAdminTokens}
          adminAvailable={adminAvailable} setAdminAvailable={setAdminAvailable}
          loading={loading} setLoading={setLoading}
        />
      )}
    </div>
  );
}

// 我的数据看板组件
function MyStatsTab({ stats }) {
  if (!stats) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  const GRADE_COLORS = {
    "A": "bg-green-500", "B": "bg-blue-500", "C": "bg-yellow-500", "D": "bg-red-500",
  };

  const INDUSTRY_COLORS = [
    "bg-blue-500", "bg-purple-500", "bg-green-500", "bg-orange-500",
    "bg-pink-500", "bg-cyan-500", "bg-yellow-500", "bg-slate-500",
  ];

  const maxIndustryCount = stats.industry_dist.length > 0
    ? Math.max(...stats.industry_dist.map(d => d.count))
    : 1;

  const maxGradeCount = stats.grade_dist.length > 0
    ? Math.max(...stats.grade_dist.map(d => d.count))
    : 1;

  return (
    <div className="space-y-6">
      {/* 汇总指标卡 */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        <div className="bg-slate-900/50 border border-white/10 rounded-xl p-5 text-center">
          <div className="text-3xl font-bold text-blue-400">{stats.total_count}</div>
          <div className="text-sm text-slate-400 mt-1">累计分析 BP</div>
        </div>
        <div className="bg-slate-900/50 border border-white/10 rounded-xl p-5 text-center">
          <div className="text-3xl font-bold text-emerald-400">
            {stats.avg_score !== null ? stats.avg_score : "—"}
          </div>
          <div className="text-sm text-slate-400 mt-1">平均评分</div>
        </div>
        <div className="bg-slate-900/50 border border-white/10 rounded-xl p-5 text-center col-span-2 sm:col-span-1">
          <div className="text-3xl font-bold text-purple-400">
            {stats.industry_dist.length > 0 ? stats.industry_dist[0].industry : "—"}
          </div>
          <div className="text-sm text-slate-400 mt-1">最多分析赛道</div>
        </div>
      </div>

      {/* 赛道分布 */}
      {stats.industry_dist.length > 0 && (
        <div className="bg-slate-900/50 border border-white/10 rounded-xl p-6">
          <h3 className="text-base font-semibold mb-4">赛道分布</h3>
          <div className="space-y-3">
            {stats.industry_dist.map((item, i) => (
              <div key={item.industry}>
                <div className="flex items-center justify-between text-sm mb-1">
                  <span className="text-slate-300">{item.industry}</span>
                  <span className="text-slate-400 tabular-nums">{item.count} 次</span>
                </div>
                <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${INDUSTRY_COLORS[i % INDUSTRY_COLORS.length]}`}
                    style={{ width: `${(item.count / maxIndustryCount) * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 评级分布 */}
      {stats.grade_dist.length > 0 && (
        <div className="bg-slate-900/50 border border-white/10 rounded-xl p-6">
          <h3 className="text-base font-semibold mb-4">评级分布</h3>
          <div className="flex items-end gap-3 h-32">
            {["A", "B", "C", "D"].map((grade) => {
              const item = stats.grade_dist.find(d => d.grade === grade);
              const count = item?.count || 0;
              const pct = count > 0 ? (count / maxGradeCount) * 100 : 0;
              return (
                <div key={grade} className="flex-1 flex flex-col items-center gap-1">
                  <span className="text-xs text-slate-400 tabular-nums">{count || ""}</span>
                  <div className="w-full flex items-end" style={{ height: "80px" }}>
                    <div
                      className={`w-full rounded-t transition-all ${count > 0 ? (GRADE_COLORS[grade] || "bg-slate-500") : "bg-slate-800"}`}
                      style={{ height: `${Math.max(pct, count > 0 ? 10 : 0)}%` }}
                    />
                  </div>
                  <span className="text-xs text-slate-500">{grade}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 最近分析 */}
      {stats.recent.length > 0 && (
        <div className="bg-slate-900/50 border border-white/10 rounded-xl p-6">
          <h3 className="text-base font-semibold mb-4">最近分析</h3>
          <div className="space-y-2">
            {stats.recent.map((task) => (
              <div key={task.id} className="flex items-center justify-between py-2 border-b border-white/10 last:border-0">
                <div>
                  <div className="text-sm font-medium">{task.title}</div>
                  <div className="text-xs text-slate-500 mt-0.5">{task.industry_category}</div>
                </div>
                <div className="text-xs text-slate-500 shrink-0 ml-4">
                  {new Date(task.created_at).toLocaleDateString("zh-CN")}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {stats.total_count === 0 && (
        <div className="text-center py-16 bg-slate-900/50 rounded-xl border border-white/10">
          <BarChart3 className="w-12 h-12 text-slate-600 mx-auto mb-4" />
          <p className="text-slate-400">暂无分析数据</p>
          <p className="text-sm text-slate-600 mt-1">上传 BP 开始第一次分析吧</p>
        </div>
      )}
    </div>
  );
}

// 账户安全组件
function AccountTab({ profile, email, setEmail, emailCode, setEmailCode, sendingEmailCode, emailCountdown, handleSendEmailCode, handleBindEmail, oldPassword, setOldPassword, newPassword, setNewPassword, confirmPassword, setConfirmPassword, loading, setMessage }) {
  return (
    <div className="space-y-6">
      <div className="bg-slate-900/50 border border-white/10 rounded-xl p-6">
        <h3 className="text-lg font-bold mb-4">基本信息</h3>
        <div className="space-y-4">
          <div>
            <label className="block text-sm text-slate-400 mb-1">用户名</label>
            <input type="text" value={profile?.username || ""} disabled className="w-full px-4 py-2 bg-slate-800 border border-white/10 rounded-lg text-slate-500" />
          </div>
          <div>
            <label className="block text-sm text-slate-400 mb-1">邮箱</label>
            <div className="space-y-2">
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="请输入邮箱" disabled={!!profile?.email} className="w-full px-4 py-2 bg-slate-800 border border-white/10 rounded-lg focus:border-blue-500 focus:outline-none disabled:opacity-50" />
              {profile?.email ? (
                <p className="text-sm text-green-400 flex items-center gap-1"><CheckCircle className="w-4 h-4" /> 已绑定邮箱</p>
              ) : (
                <div className="flex gap-2">
                  <input type="text" value={emailCode} onChange={(e) => setEmailCode(e.target.value)} placeholder="输入验证码" className="flex-1 px-4 py-2 bg-slate-800 border border-white/10 rounded-lg focus:border-blue-500 focus:outline-none" />
                  <button onClick={handleSendEmailCode} disabled={sendingEmailCode || emailCountdown > 0} className="px-4 py-2 bg-slate-700 hover:bg-slate-600 disabled:bg-slate-800 disabled:text-slate-500 rounded-lg font-medium flex items-center gap-2">
                    {sendingEmailCode ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                    {emailCountdown > 0 ? `${emailCountdown}s` : "发送验证码"}
                  </button>
                  <button onClick={handleBindEmail} disabled={loading || !emailCode} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 rounded-lg">绑定</button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
      <div className="bg-slate-900/50 border border-white/10 rounded-xl p-6">
        <h3 className="text-lg font-bold mb-4 flex items-center gap-2"><Lock className="w-5 h-5" />修改密码</h3>
        <div className="space-y-4">
          <div><label className="block text-sm text-slate-400 mb-1">旧密码</label><input type="password" value={oldPassword} onChange={(e) => setOldPassword(e.target.value)} className="w-full px-4 py-2 bg-slate-800 border border-white/10 rounded-lg" /></div>
          <div><label className="block text-sm text-slate-400 mb-1">新密码</label><input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className="w-full px-4 py-2 bg-slate-800 border border-white/10 rounded-lg" /></div>
          <div><label className="block text-sm text-slate-400 mb-1">确认新密码</label><input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} className="w-full px-4 py-2 bg-slate-800 border border-white/10 rounded-lg" /></div>
          <button onClick={async () => {
            if (newPassword !== confirmPassword) { setMessage({ type: "error", text: "两次密码不一致" }); return; }
            if (newPassword.length < 6) { setMessage({ type: "error", text: "密码至少6位" }); return; }
            loading = true;
            try { await api.put("/api/user/password", { oldPassword, newPassword }); setMessage({ type: "success", text: "密码修改成功" }); setOldPassword(""); setNewPassword(""); setConfirmPassword(""); } catch (err) { setMessage({ type: "error", text: err.message || "修改失败" }); } loading = false;
          }} disabled={loading || !oldPassword || !newPassword} className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 rounded-lg">
            {loading && <Loader2 className="w-4 h-4 animate-spin" />}修改密码
          </button>
        </div>
      </div>
      <div className="bg-slate-900/50 border border-white/10 rounded-xl p-6">
        <h3 className="text-lg font-bold mb-4">账户状态</h3>
        <div className="grid grid-cols-2 gap-4">
          <div className="p-4 bg-slate-800 rounded-lg"><div className="text-sm text-slate-400 mb-1">邮箱绑定</div><div className="font-medium">{profile?.email ? <span className="text-green-400">已绑定</span> : <span className="text-yellow-400">未绑定</span>}</div></div>
          <div className="p-4 bg-slate-800 rounded-lg"><div className="text-sm text-slate-400 mb-1">累计使用</div><div className="font-medium">{profile?.usage_count || 0} 次</div></div>
        </div>
      </div>
    </div>
  );
}

// 财务与额度组件
function BillingTab({ profile, orders, usage }) {
  return (
    <div className="space-y-6">
      <div className="bg-slate-900/50 border border-white/10 rounded-xl p-6">
        <h3 className="text-lg font-bold mb-4">额度概览</h3>
        <div className="grid grid-cols-3 gap-4">
          <div className="p-4 bg-slate-800 rounded-lg text-center"><div className="text-2xl font-bold text-green-400">{profile?.quota?.free || 0}</div><div className="text-sm text-slate-400">免费额度</div></div>
          <div className="p-4 bg-slate-800 rounded-lg text-center"><div className="text-2xl font-bold text-blue-400">{profile?.quota?.paid || 0}</div><div className="text-sm text-slate-400">付费额度</div></div>
          <div className="p-4 bg-slate-800 rounded-lg text-center"><div className="text-2xl font-bold text-white">{profile?.quota?.total || 0}</div><div className="text-sm text-slate-400">剩余总额</div></div>
        </div>
      </div>
      <div className="bg-slate-900/50 border border-white/10 rounded-xl p-6">
        <h3 className="text-lg font-bold mb-4">充值记录</h3>
        {orders.length === 0 ? <p className="text-slate-500 text-center py-8">暂无充值记录</p> : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead><tr className="text-left text-sm text-slate-400 border-b border-white/10"><th className="pb-3">订单号</th><th className="pb-3">金额</th><th className="pb-3">额度</th><th className="pb-3">状态</th><th className="pb-3">时间</th></tr></thead>
              <tbody>{orders.map((o) => (<tr key={o.id} className="border-b border-white/10/50 text-sm"><td className="py-3 font-mono text-slate-400">{o.order_no?.slice(0, 12)}...</td><td className="py-3">¥{o.amount}</td><td className="py-3">{o.quota_amount} 次</td><td className="py-3"><span className={`px-2 py-0.5 rounded text-xs ${o.status === "PAID" ? "bg-green-500/20 text-green-400" : o.status === "PENDING" ? "bg-yellow-500/20 text-yellow-400" : "bg-red-500/20 text-red-400"}`}>{o.status === "PAID" ? "已支付" : o.status === "PENDING" ? "待支付" : "失败"}</span></td><td className="py-3 text-slate-400">{new Date(o.created_at).toLocaleDateString("zh-CN")}</td></tr>))}</tbody>
            </table>
          </div>
        )}
      </div>
      <div className="bg-slate-900/50 border border-white/10 rounded-xl p-6">
        <h3 className="text-lg font-bold mb-4">消费明细</h3>
        {usage.length === 0 ? <p className="text-slate-500 text-center py-8">暂无消费记录</p> : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead><tr className="text-left text-sm text-slate-400 border-b border-white/10"><th className="pb-3">时间</th><th className="pb-3">类型</th><th className="pb-3">消耗</th><th className="pb-3">状态</th></tr></thead>
              <tbody>{usage.map((u) => (<tr key={u.id} className="border-b border-white/10/50 text-sm"><td className="py-3 text-slate-400">{new Date(u.created_at).toLocaleDateString("zh-CN")}</td><td className="py-3">{u.type}</td><td className="py-3">- {u.amount} 次</td><td className="py-3"><span className={`px-2 py-0.5 rounded text-xs ${u.status === "complete" ? "bg-green-500/20 text-green-400" : "bg-red-500/20 text-red-400"}`}>{u.status === "complete" ? "成功" : "失败"}</span></td></tr>))}</tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function FeedbackTab({ feedback, feedbackForm, setFeedbackForm, submitting, handleSubmit }) {
  return (
    <div className="space-y-6">
      <div className="bg-slate-900/50 border border-white/10 rounded-xl p-6">
        <h3 className="text-lg font-bold mb-4">提交反馈</h3>
        <div className="space-y-4">
          <div><label className="block text-sm text-slate-400 mb-1">反馈类型</label><select value={feedbackForm.type} onChange={(e) => setFeedbackForm({ ...feedbackForm, type: e.target.value })} className="w-full px-4 py-2 bg-slate-800 border border-white/10 rounded-lg"><option value="suggestion">功能建议</option><option value="bug">Bug 反馈</option><option value="complaint">投诉建议</option></select></div>
          <div><label className="block text-sm text-slate-400 mb-1">标题</label><input type="text" value={feedbackForm.title} onChange={(e) => setFeedbackForm({ ...feedbackForm, title: e.target.value })} placeholder="请输入标题" className="w-full px-4 py-2 bg-slate-800 border border-white/10 rounded-lg" /></div>
          <div><label className="block text-sm text-slate-400 mb-1">内容</label><textarea value={feedbackForm.content} onChange={(e) => setFeedbackForm({ ...feedbackForm, content: e.target.value })} placeholder="请详细描述您的问题或建议" rows={4} className="w-full px-4 py-2 bg-slate-800 border border-white/10 rounded-lg" /></div>
          <button onClick={handleSubmit} disabled={submitting} className="px-6 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 rounded-lg font-medium flex items-center gap-2">{submitting && <Loader2 className="w-4 h-4 animate-spin" />}提交反馈</button>
        </div>
      </div>
      <div className="bg-slate-900/50 border border-white/10 rounded-xl p-6">
        <h3 className="text-lg font-bold mb-4">我的反馈</h3>
        {feedback.length === 0 ? <p className="text-slate-500 text-center py-8">暂无反馈记录</p> : (
          <div className="space-y-3">
            {feedback.map((f) => (
              <div key={f.id} className="p-4 bg-slate-800 rounded-lg">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-medium">{f.title}</span>
                  <span className={`px-2 py-0.5 rounded text-xs ${f.status === "pending" ? "bg-yellow-500/20 text-yellow-400" : f.status === "processed" ? "bg-blue-500/20 text-blue-400" : "bg-green-500/20 text-green-400"}`}>
                    {f.status === "pending" ? "待处理" : f.status === "processed" ? "已处理" : "已解决"}
                  </span>
                </div>
                <p className="text-sm text-slate-400 mb-2">{f.content}</p>
                {f.admin_reply && <div className="text-sm text-green-400 border-t border-white/10 pt-2 mt-2"><span className="font-medium">回复：</span>{f.admin_reply}</div>}
                <div className="text-xs text-slate-500 mt-2">{new Date(f.created_at).toLocaleString("zh-CN")}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// 兑换码 + 价格套餐 + 邀请好友 组件
function TokenTab({ redeemToken, setRedeemToken, redeeming, handleRedeem, generatedToken, generating, tokenQuota, setTokenQuota, handleGenerate, copyToken, isAdmin }) {
  const [inviteCode, setInviteCode] = useState("");
  const [referralStats, setReferralStats] = useState(null);
  const [inviteCopied, setInviteCopied] = useState(false);
  const [purchaseInfo, setPurchaseInfo] = useState(null);

  useEffect(() => {
    api.get("/api/user/invite-code").then((d) => setInviteCode(d.invite_code || "")).catch(() => {});
    api.get("/api/user/referral-stats").then((d) => setReferralStats(d)).catch(() => {});
    api.get("/api/admin/site-content/purchase_info").then((d) => setPurchaseInfo(d)).catch(() => {});
  }, []);

  const PRICING_PLANS = [
    { quota: 5, price: 25, unitPrice: "5.0" },
    { quota: 15, price: 60, unitPrice: "4.0", popular: true },
    { quota: 30, price: 100, unitPrice: "3.3" },
    { quota: 50, price: 150, unitPrice: "3.0" },
  ];

  return (
    <div className="space-y-6">
      {/* 兑换码输入 */}
      <div className="bg-slate-900/50 border border-white/10 rounded-xl p-6">
        <h3 className="text-lg font-bold mb-4 text-white">兑换额度</h3>
        <p className="text-sm text-slate-400 mb-4">输入兑换码即可获得分析额度</p>
        <div className="flex gap-2">
          <input type="text" value={redeemToken} onChange={(e) => setRedeemToken(e.target.value)} placeholder="输入兑换码" className="flex-1 px-4 py-2 bg-slate-800 border border-white/10 rounded-lg text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none" />
          <button onClick={handleRedeem} disabled={redeeming || !redeemToken} className="px-6 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-700 rounded-lg font-medium flex items-center gap-2 transition-colors">
            {redeeming && <Loader2 className="w-4 h-4 animate-spin" />}兑换
          </button>
        </div>
      </div>

      {/* 价格套餐 */}
      <div className="bg-slate-900/50 border border-white/10 rounded-xl p-6">
        <h3 className="text-lg font-bold mb-2 text-white">额度套餐</h3>
        <p className="text-sm text-slate-400 mb-5">购买兑换码请微信联系管理员 <span className="text-blue-400 font-medium">pe_ren</span></p>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          {PRICING_PLANS.map((plan) => (
            <div
              key={plan.quota}
              className={`relative p-5 rounded-xl border text-center transition-all ${
                plan.popular
                  ? "border-blue-500/50 bg-blue-500/5 ring-1 ring-blue-500/20"
                  : "border-white/10 bg-slate-800/50 hover:border-white/20"
              }`}
            >
              {plan.popular && (
                <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 text-[10px] bg-blue-500 text-white px-2 py-0.5 rounded-full font-medium">
                  推荐
                </span>
              )}
              <div className="text-3xl font-bold text-white mb-1">{plan.quota}<span className="text-base font-normal text-slate-400">次</span></div>
              <div className="text-xl font-bold text-blue-400 mb-1">¥{plan.price}</div>
              <div className="text-xs text-slate-500">¥{plan.unitPrice}/次</div>
            </div>
          ))}
        </div>

        {/* 购买说明（管理员可配置） */}
        {purchaseInfo && (
          <div className="p-4 bg-slate-800/50 border border-white/10 rounded-xl">
            <div className="flex flex-col sm:flex-row items-center gap-4">
              {purchaseInfo.images?.length > 0 && (
                <div className="flex gap-3 shrink-0">
                  {purchaseInfo.images.map((img, i) => (
                    <img key={i} src={img} alt={`购买说明图片${i + 1}`} className="w-32 h-32 rounded-lg bg-white p-1 object-contain" />
                  ))}
                </div>
              )}
              <div className="text-center sm:text-left">
                {purchaseInfo.title && <p className="text-white font-medium mb-1">{purchaseInfo.title}</p>}
                {purchaseInfo.body && purchaseInfo.body.split("\n").map((line, i) => (
                  <p key={i} className="text-sm text-slate-400">{line}</p>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 邀请好友得额度 */}
      <div className="bg-slate-900/50 border border-white/10 rounded-xl p-6">
        <h3 className="text-lg font-bold mb-2 text-white">邀请好友得额度</h3>
        <p className="text-sm text-slate-400 mb-4">每成功邀请一位好友注册，您将获得 2 次免费分析额度</p>
        {inviteCode ? (
          <div className="space-y-3">
            <div>
              <label className="block text-sm text-slate-400 mb-1">您的专属邀请链接</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  readOnly
                  value={`${window.location.origin}/login?ref=${inviteCode}`}
                  className="flex-1 px-4 py-2 bg-slate-800 border border-white/10 rounded-lg text-sm text-slate-300"
                />
                <button
                  onClick={async () => {
                    const link = `${window.location.origin}/login?ref=${inviteCode}`;
                    try {
                      await navigator.clipboard.writeText(link);
                      setInviteCopied(true);
                      setTimeout(() => setInviteCopied(false), 2000);
                    } catch (err) {
                      const textArea = document.createElement("textarea");
                      textArea.value = link;
                      textArea.style.position = "fixed";
                      textArea.style.left = "-999999px";
                      document.body.appendChild(textArea);
                      textArea.select();
                      try { document.execCommand("copy"); setInviteCopied(true); setTimeout(() => setInviteCopied(false), 2000); } catch (e) { alert("复制失败，请手动复制链接"); }
                      document.body.removeChild(textArea);
                    }
                  }}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm flex items-center gap-1.5 shrink-0 transition-colors"
                >
                  {inviteCopied ? <><CheckCircle className="w-4 h-4" />已复制</> : <><Copy className="w-4 h-4" />复制</>}
                </button>
              </div>
            </div>
            {referralStats && (
              <div className="flex gap-4 pt-2">
                <div className="text-center">
                  <div className="text-xl font-bold text-blue-400">{referralStats.invited_count}</div>
                  <div className="text-xs text-slate-500">已邀请人数</div>
                </div>
                <div className="text-center">
                  <div className="text-xl font-bold text-emerald-400">{referralStats.earned_quota}</div>
                  <div className="text-xs text-slate-500">获得额度</div>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="text-center py-4"><Loader2 className="w-5 h-5 animate-spin mx-auto text-slate-500" /></div>
        )}
      </div>

      {/* 管理员生成兑换码 */}
      {isAdmin && (
        <div className="bg-slate-900/50 border border-white/10 rounded-xl p-6">
          <h3 className="text-lg font-bold mb-4 text-white">生成兑换码（管理员）</h3>
          <div className="flex gap-2 mb-4">
            <select value={tokenQuota} onChange={(e) => setTokenQuota(parseInt(e.target.value))} className="px-4 py-2 bg-slate-800 border border-white/10 rounded-lg text-white">
              <option value={1}>1 次</option><option value={5}>5 次</option><option value={10}>10 次</option><option value={15}>15 次</option><option value={30}>30 次</option><option value={50}>50 次</option>
            </select>
            <button onClick={handleGenerate} disabled={generating} className="px-6 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 rounded-lg font-medium flex items-center gap-2 transition-colors">
              {generating && <Loader2 className="w-4 h-4 animate-spin" />}生成
            </button>
          </div>
          {generatedToken && (
            <div className="p-4 bg-slate-800 rounded-lg">
              <div className="text-sm text-slate-400 mb-2">兑换码（有效期30天）</div>
              <div className="flex items-center gap-2">
                <code className="flex-1 text-xl font-mono font-bold text-emerald-400">{generatedToken.token}</code>
                <button onClick={copyToken} className="p-2 hover:bg-slate-700 rounded-lg"><Copy className="w-5 h-5" /></button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// 用户管理组件
function UsersTab({ users, total, page, setPage, search, setSearch, status, setStatus, loadUsers, setSelectedUser, selectedUser, loading, setLoading, setMessage }) {
  const handleBan = async (userId, banned) => {
    try {
      await api.post(`/api/admin/users/${userId}/ban`, { banned });
      setMessage({ type: "success", text: banned ? "已禁用用户" : "已启用用户" });
      loadUsers();
    } catch (err) {
      setMessage({ type: "error", text: err.message });
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-slate-900/50 border border-white/10 rounded-xl p-6">
        <div className="flex gap-4 mb-4">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜索用户名/邮箱" className="w-full pl-10 pr-4 py-2 bg-slate-800 border border-white/10 rounded-lg" />
          </div>
          <select value={status} onChange={(e) => setStatus(e.target.value)} className="px-4 py-2 bg-slate-800 border border-white/10 rounded-lg">
            <option value="">全部</option><option value="active">正常</option><option value="banned">已禁用</option>
          </select>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead><tr className="text-left text-sm text-slate-400 border-b border-white/10"><th className="pb-3">ID</th><th className="pb-3">用户名</th><th className="pb-3">邮箱</th><th className="pb-3">额度</th><th className="pb-3">使用次数</th><th className="pb-3">状态</th><th className="pb-3">注册时间</th><th className="pb-3">操作</th></tr></thead>
            <tbody>{users.map((u) => (<tr key={u.id} className="border-b border-white/10/50 text-sm"><td className="py-3">{u.id}</td><td className="py-3 font-medium">{u.username}</td><td className="py-3 text-slate-400">{u.email || "-"}</td><td className="py-3">{u.total_quota || 0}</td><td className="py-3">{u.usage_count || 0}</td><td className="py-3"><span className={`px-2 py-0.5 rounded text-xs ${u.is_banned ? "bg-red-500/20 text-red-400" : "bg-green-500/20 text-green-400"}`}>{u.is_banned ? "已禁用" : "正常"}</span></td><td className="py-3 text-slate-400">{new Date(u.created_at).toLocaleDateString("zh-CN")}</td><td className="py-3"><div className="flex gap-2"><button onClick={() => setSelectedUser(u)} className="p-1 hover:bg-slate-700 rounded"><Eye className="w-4 h-4" /></button><button onClick={() => handleBan(u.id, !u.is_banned)} className={`p-1 rounded ${u.is_banned ? "hover:bg-green-500/20 text-green-400" : "hover:bg-red-500/20 text-red-400"}`}>{u.is_banned ? "启用" : "禁用"}</button></div></td></tr>))}</tbody>
          </table>
        </div>
        {total > 20 && <div className="flex justify-center gap-2 mt-4">
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="px-3 py-1 bg-slate-800 rounded disabled:opacity-50">上一页</button>
          <span className="px-3 py-1">第 {page} / {Math.ceil(total / 20)} 页</span>
          <button onClick={() => setPage(p => p + 1)} disabled={page * 20 >= total} className="px-3 py-1 bg-slate-800 rounded disabled:opacity-50">下一页</button>
        </div>}
      </div>
      {selectedUser && <UserDetailModal user={selectedUser} onClose={() => setSelectedUser(null)} />}
    </div>
  );
}

function UserDetailModal({ user, onClose }) {
  const [details, setDetails] = useState(null);
  useEffect(() => { api.get(`/api/admin/users/${user.id}`).then((d) => setDetails(d)).catch(console.error); }, [user.id]);
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-slate-900/50 border border-white/10 rounded-xl p-6 w-full max-w-2xl max-h-[80vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-bold">用户详情</h3>
          <button onClick={onClose}><X className="w-5 h-5" /></button>
        </div>
        {details ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div><div className="text-sm text-slate-400">用户名</div><div className="font-medium">{user.username}</div></div>
              <div><div className="text-sm text-slate-400">邮箱</div><div className="font-medium">{user.email || "-"}</div></div>
              <div><div className="text-sm text-slate-400">免费额度</div><div className="font-medium">{details.user.free_quota}</div></div>
              <div><div className="text-sm text-slate-400">付费额度</div><div className="font-medium">{details.user.paid_quota}</div></div>
            </div>
            <div><h4 className="font-medium mb-2">最近订单</h4>
              {details.orders.length === 0 ? <p className="text-slate-500">暂无</p> : <div className="space-y-2">{details.orders.map((o) => (<div key={o.id} className="p-2 bg-slate-800 rounded text-sm"><span className="font-mono">{o.order_no?.slice(0, 16)}</span> - ¥{o.amount_cents/100} - <span className={o.status === "PAID" ? "text-green-400" : "text-slate-400"}>{o.status}</span></div>))}</div>}
            </div>
            <div><h4 className="font-medium mb-2">最近分析</h4>
              {details.tasks.length === 0 ? <p className="text-slate-500">暂无</p> : <div className="space-y-2">{details.tasks.map((t) => (<div key={t.id} className="p-2 bg-slate-800 rounded text-sm"><span className="font-mono">{t.id?.slice(0, 8)}</span> - {t.stage} - {t.percentage}%</div>))}</div>}
            </div>
          </div>
        ) : <div className="text-center py-8"><Loader2 className="w-6 h-6 animate-spin mx-auto" /></div>}
      </div>
    </div>
  );
}

// 分析记录组件
function TasksTab({ tasks, total, page, setPage, status, setStatus, search, setSearch, loadTasks, selectedTask, setSelectedTask }) {
  return (
    <div className="space-y-6">
      <div className="bg-slate-900/50 border border-white/10 rounded-xl p-6">
        <div className="flex gap-4 mb-4">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜索用户名/任务ID" className="w-full pl-10 pr-4 py-2 bg-slate-800 border border-white/10 rounded-lg" />
          </div>
          <select value={status} onChange={(e) => setStatus(e.target.value)} className="px-4 py-2 bg-slate-800 border border-white/10 rounded-lg">
            <option value="">全部状态</option>
            <option value="running">分析中</option>
            <option value="complete">已完成</option>
            <option value="error">失败</option>
          </select>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead><tr className="text-left text-sm text-slate-400 border-b border-white/10"><th className="pb-3">任务ID</th><th className="pb-3">用户</th><th className="pb-3">状态</th><th className="pb-3">进度</th><th className="pb-3">阶段</th><th className="pb-3">创建时间</th><th className="pb-3">操作</th></tr></thead>
            <tbody>{tasks.map((t) => (<tr key={t.id} className="border-b border-white/10/50 text-sm"><td className="py-3 font-mono text-slate-400">{t.id?.slice(0, 12)}...</td><td className="py-3">{t.username || "匿名"}</td><td className="py-3"><span className={`px-2 py-0.5 rounded text-xs ${t.status === "complete" ? "bg-green-500/20 text-green-400" : t.status === "running" ? "bg-blue-500/20 text-blue-400" : "bg-red-500/20 text-red-400"}`}>{t.status === "complete" ? "已完成" : t.status === "running" ? "分析中" : "失败"}</span></td><td className="py-3">{t.percentage}%</td><td className="py-3 text-slate-400">{t.stage}</td><td className="py-3 text-slate-400">{new Date(t.created_at).toLocaleString("zh-CN")}</td><td className="py-3"><button onClick={() => setSelectedTask(t)} className="p-1 hover:bg-slate-700 rounded"><Eye className="w-4 h-4" /></button></td></tr>))}</tbody>
          </table>
        </div>
        {total > 20 && <div className="flex justify-center gap-2 mt-4">
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="px-3 py-1 bg-slate-800 rounded disabled:opacity-50">上一页</button>
          <span className="px-3 py-1">第 {page} / {Math.ceil(total / 20)} 页</span>
          <button onClick={() => setPage(p => p + 1)} disabled={page * 20 >= total} className="px-3 py-1 bg-slate-800 rounded disabled:opacity-50">下一页</button>
        </div>}
      </div>
      {selectedTask && <TaskDetailModal task={selectedTask} onClose={() => setSelectedTask(null)} />}
    </div>
  );
}

function TaskDetailModal({ task, onClose }) {
  const [detail, setDetail] = useState(null);
  useEffect(() => { api.get(`/api/admin/tasks/${task.id}`).then((d) => setDetail(d.task)).catch(console.error); }, [task.id]);
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-slate-900/50 border border-white/10 rounded-xl p-6 w-full max-w-2xl max-h-[80vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-bold">分析详情</h3>
          <button onClick={onClose}><X className="w-5 h-5" /></button>
        </div>
        {detail ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div><div className="text-sm text-slate-400">任务ID</div><div className="font-mono text-sm">{detail.id}</div></div>
              <div><div className="text-sm text-slate-400">用户</div><div className="font-medium">{detail.username || "匿名"}</div></div>
              <div><div className="text-sm text-slate-400">状态</div><div className={`px-2 py-0.5 rounded text-xs inline-block ${detail.status === "complete" ? "bg-green-500/20 text-green-400" : detail.status === "running" ? "bg-blue-500/20 text-blue-400" : "bg-red-500/20 text-red-400"}`}>{detail.status === "complete" ? "已完成" : detail.status === "running" ? "分析中" : "失败"}</div></div>
              <div><div className="text-sm text-slate-400">进度</div><div className="font-medium">{detail.percentage}%</div></div>
              <div><div className="text-sm text-slate-400">阶段</div><div className="font-medium">{detail.stage}</div></div>
              <div><div className="text-sm text-slate-400">创建时间</div><div className="font-medium">{new Date(detail.created_at).toLocaleString("zh-CN")}</div></div>
            </div>
            {detail.message && <div><h4 className="font-medium mb-2">消息</h4><div className="p-3 bg-slate-800 rounded text-sm">{detail.message}</div></div>}
            {detail.error && <div><h4 className="font-medium mb-2 text-red-400">错误信息</h4><div className="p-3 bg-red-500/10 rounded text-sm text-red-400">{detail.error}</div></div>}
            {detail.result && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h4 className="font-medium">分析结果</h4>
                  {detail.status === "complete" && (
                    <button
                      onClick={() => window.open(`/report/${detail.id}`, "_blank")}
                      className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm flex items-center gap-1.5"
                    >
                      <Eye className="w-4 h-4" />
                      查看完整报告
                    </button>
                  )}
                </div>
                <div className="p-3 bg-slate-800 rounded text-sm max-h-60 overflow-auto">
                  <pre className="whitespace-pre-wrap">{typeof detail.result === "string" ? detail.result : JSON.stringify(detail.result, null, 2)}</pre>
                </div>
              </div>
            )}
          </div>
        ) : <div className="text-center py-8"><Loader2 className="w-6 h-6 animate-spin mx-auto" /></div>}
      </div>
    </div>
  );
}

// 数据统计组件
function StatsTab({ stats }) {
  if (!stats) return <div className="text-center py-8"><Loader2 className="w-6 h-6 animate-spin mx-auto" /></div>;

  // 计算分析状态分布的饼图数据
  const totalTasks = stats.taskStatusDist?.reduce((sum, item) => sum + item.count, 0) || 0;
  const statusColors = { complete: "#22c55e", running: "#3b82f6", error: "#ef4444", queued: "#6b7280", failed: "#f59e0b" };
  const statusLabels = { complete: "已完成", running: "分析中", error: "失败", queued: "排队中", failed: "中断" };

  // 计算饼图渐变
  let cumulativePercent = 0;
  const pieData = stats.taskStatusDist?.map(item => {
    const percent = totalTasks > 0 ? (item.count / totalTasks) * 100 : 0;
    const start = cumulativePercent;
    cumulativePercent += percent;
    return { ...item, percent, start, end: cumulativePercent, color: statusColors[item.status] || "#6b7280" };
  }) || [];

  // 计算趋势图最大值的归一化
  const maxUserCount = Math.max(...(stats.userTrend?.map(t => t.count) || [1]), 1);
  const maxRevenue = Math.max(...(stats.revenueTrend?.map(t => t.total) || [1]), 1);
  const maxDailyAnalysis = Math.max(...(stats.dailyAnalysisTrend?.map(t => t.count) || [1]), 1);

  // 评分等级分布
  const gradeColors = { A: "#22c55e", B: "#3b82f6", C: "#f59e0b", D: "#ef4444" };
  const totalGraded = stats.gradeDist?.reduce((sum, g) => sum + g.count, 0) || 0;

  // 行业分布
  const industryColors = ["#8b5cf6", "#3b82f6", "#22c55e", "#f59e0b", "#ef4444", "#ec4899", "#06b6d4", "#6b7280"];
  let industryCumulativePercent = 0;
  const totalIndustry = stats.industryDist?.reduce((sum, i) => sum + i.count, 0) || 0;
  const industryPieData = stats.industryDist?.map((item, idx) => {
    const percent = totalIndustry > 0 ? (item.count / totalIndustry) * 100 : 0;
    const start = industryCumulativePercent;
    industryCumulativePercent += percent;
    return { ...item, percent, start, end: industryCumulativePercent, color: industryColors[idx % industryColors.length] };
  }) || [];

  return (
    <div className="space-y-6">
      {/* 核心指标卡片 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-slate-900/50 border border-white/10 rounded-xl p-6"><div className="text-sm text-slate-400 mb-1">总用户</div><div className="text-2xl font-bold">{stats.totalUsers}</div></div>
        <div className="bg-slate-900/50 border border-white/10 rounded-xl p-6"><div className="text-sm text-slate-400 mb-1">活跃用户(7天)</div><div className="text-2xl font-bold text-green-400">{stats.activeUsers}</div></div>
        <div className="bg-slate-900/50 border border-white/10 rounded-xl p-6"><div className="text-sm text-slate-400 mb-1">累计收入</div><div className="text-2xl font-bold text-yellow-400">¥{(stats.totalRevenue / 100).toFixed(2)}</div></div>
        <div className="bg-slate-900/50 border border-white/10 rounded-xl p-6"><div className="text-sm text-slate-400 mb-1">总分析次数</div><div className="text-2xl font-bold text-blue-400">{stats.totalAnalyzes}</div></div>
      </div>

      {/* 第二行指标卡片 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-slate-900/50 border border-white/10 rounded-xl p-6"><div className="text-sm text-slate-400 mb-1">用户留存率</div><div className="text-2xl font-bold text-purple-400">{stats.retentionRate || 0}%</div><div className="text-xs text-slate-500">注册后7天内回访</div></div>
        <div className="bg-slate-900/50 border border-white/10 rounded-xl p-6"><div className="text-sm text-slate-400 mb-1">兑换码总数</div><div className="text-2xl font-bold">{stats.tokenStats?.total || 0}</div><div className="text-xs text-slate-500">已用 {stats.tokenStats?.used || 0} · 可用 {stats.tokenStats?.available || 0}</div></div>
        <div className="bg-slate-900/50 border border-white/10 rounded-xl p-6"><div className="text-sm text-slate-400 mb-1">兑换码使用率</div><div className="text-2xl font-bold text-cyan-400">{stats.tokenStats?.total > 0 ? Math.round((stats.tokenStats.used / stats.tokenStats.total) * 100) : 0}%</div></div>
        <div className="bg-slate-900/50 border border-white/10 rounded-xl p-6"><div className="text-sm text-slate-400 mb-1">平均评分</div><div className="text-2xl font-bold text-orange-400">{totalGraded > 0 ? (() => { const scoreMap = { A: 90, B: 75, C: 65, D: 45 }; const avg = stats.gradeDist.reduce((s, g) => s + (scoreMap[g.grade] || 0) * g.count, 0) / totalGraded; return avg.toFixed(0); })() : "-"}</div></div>
      </div>

      {/* 可视化仪表盘 Row 1 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 分析状态分布饼图 */}
        <div className="bg-slate-900/50 border border-white/10 rounded-xl p-6">
          <h3 className="text-lg font-bold mb-4">分析状态分布</h3>
          <div className="flex items-center gap-8">
            <div className="relative w-32 h-32">
              <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
                {pieData.map((item, i) => (
                  <circle
                    key={i}
                    cx="50" cy="50" r="40"
                    fill="none"
                    stroke={item.color}
                    strokeWidth="20"
                    strokeDasharray={`${item.percent * 2.51} ${251 - item.percent * 2.51}`}
                    strokeDashoffset={`${-item.start * 2.51}`}
                  />
                ))}
                <circle cx="50" cy="50" r="25" fill="#1f2937" />
              </svg>
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-lg font-bold">{totalTasks}</span>
              </div>
            </div>
            <div className="space-y-2">
              {pieData.map((item) => (
                <div key={item.status} className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: item.color }} />
                  <span className="text-sm text-slate-400">{statusLabels[item.status] || item.status}:</span>
                  <span className="text-sm font-medium">{item.count} ({item.percent.toFixed(1)}%)</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* 评分等级分布柱状图 */}
        <div className="bg-slate-900/50 border border-white/10 rounded-xl p-6">
          <h3 className="text-lg font-bold mb-4">评分等级分布</h3>
          {totalGraded === 0 ? <p className="text-slate-500 text-center py-8">暂无数据</p> : (
            <div className="flex items-end justify-center gap-6 h-40">
              {["A", "B", "C", "D"].map((grade) => {
                const item = stats.gradeDist?.find(g => g.grade === grade) || { count: 0 };
                const heightPct = totalGraded > 0 ? (item.count / totalGraded) * 100 : 0;
                return (
                  <div key={grade} className="flex flex-col items-center gap-1">
                    <span className="text-xs text-slate-400">{item.count}</span>
                    <div className="w-12 rounded-t-md" style={{ height: `${Math.max(heightPct, 4)}%`, backgroundColor: gradeColors[grade] }} />
                    <span className="text-sm font-bold" style={{ color: gradeColors[grade] }}>{grade}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* 可视化仪表盘 Row 2 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* BP 行业分布饼图 */}
        <div className="bg-slate-900/50 border border-white/10 rounded-xl p-6">
          <h3 className="text-lg font-bold mb-4">BP 行业分布</h3>
          {totalIndustry === 0 ? <p className="text-slate-500 text-center py-8">暂无数据</p> : (
            <div className="flex items-center gap-8">
              <div className="relative w-32 h-32">
                <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
                  {industryPieData.map((item, i) => (
                    <circle
                      key={i}
                      cx="50" cy="50" r="40"
                      fill="none"
                      stroke={item.color}
                      strokeWidth="20"
                      strokeDasharray={`${item.percent * 2.51} ${251 - item.percent * 2.51}`}
                      strokeDashoffset={`${-item.start * 2.51}`}
                    />
                  ))}
                  <circle cx="50" cy="50" r="25" fill="#1f2937" />
                </svg>
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-lg font-bold">{totalIndustry}</span>
                </div>
              </div>
              <div className="space-y-1 max-h-40 overflow-y-auto">
                {industryPieData.map((item) => (
                  <div key={item.category} className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: item.color }} />
                    <span className="text-sm text-slate-400 truncate">{item.category}:</span>
                    <span className="text-sm font-medium">{item.count}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* 套餐销售占比 */}
        <div className="bg-slate-900/50 border border-white/10 rounded-xl p-6">
          <h3 className="text-lg font-bold mb-4">套餐销售统计</h3>
          {(!stats.packageSalesDist || stats.packageSalesDist.length === 0) ? <p className="text-slate-500 text-center py-8">暂无数据</p> : (
            <div className="space-y-3">
              {stats.packageSalesDist.map((p) => (
                <div key={p.quota_amount} className="flex items-center justify-between p-3 bg-slate-800 rounded-lg">
                  <div>
                    <span className="font-medium">{p.quota_amount}次套餐</span>
                    <span className="text-xs text-slate-500 ml-2">共{p.count}单</span>
                  </div>
                  <span className="font-bold text-green-400">¥{(p.revenue / 100).toFixed(0)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 用户增长趋势条形图 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-slate-900/50 border border-white/10 rounded-xl p-6">
          <h3 className="text-lg font-bold mb-4">用户增长趋势（最近30天）</h3>
          {stats.userTrend.length === 0 ? <p className="text-slate-500 text-center py-8">暂无数据</p> : (
            <div className="space-y-1">
              {stats.userTrend.slice(-10).map((t) => (
                <div key={t.date} className="flex items-center gap-2">
                  <span className="text-xs text-slate-500 w-20">{t.date.slice(5)}</span>
                  <div className="flex-1 h-4 bg-slate-800 rounded overflow-hidden">
                    <div className="h-full bg-gradient-to-r from-blue-500 to-blue-400 rounded" style={{ width: `${(t.count / maxUserCount) * 100}%` }} />
                  </div>
                  <span className="text-xs text-slate-400 w-8 text-right">{t.count}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 日均分析量趋势 */}
        <div className="bg-slate-900/50 border border-white/10 rounded-xl p-6">
          <h3 className="text-lg font-bold mb-4">日均分析量（最近30天）</h3>
          {(!stats.dailyAnalysisTrend || stats.dailyAnalysisTrend.length === 0) ? <p className="text-slate-500 text-center py-8">暂无数据</p> : (
            <div className="space-y-1">
              {stats.dailyAnalysisTrend.slice(-10).map((t) => (
                <div key={t.date} className="flex items-center gap-2">
                  <span className="text-xs text-slate-500 w-20">{t.date.slice(5)}</span>
                  <div className="flex-1 h-4 bg-slate-800 rounded overflow-hidden">
                    <div className="h-full bg-gradient-to-r from-purple-500 to-purple-400 rounded" style={{ width: `${(t.count / maxDailyAnalysis) * 100}%` }} />
                  </div>
                  <span className="text-xs text-slate-400 w-8 text-right">{t.count}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 收入趋势 */}
      <div className="bg-slate-900/50 border border-white/10 rounded-xl p-6">
        <h3 className="text-lg font-bold mb-4">收入趋势（最近30天）</h3>
        {stats.revenueTrend.length === 0 ? <p className="text-slate-500 text-center py-8">暂无数据</p> : (
          <div className="space-y-1">
            {stats.revenueTrend.slice(-10).map((t) => (
              <div key={t.date} className="flex items-center gap-2">
                <span className="text-xs text-slate-500 w-20">{t.date.slice(5)}</span>
                <div className="flex-1 h-4 bg-slate-800 rounded overflow-hidden">
                  <div className="h-full bg-gradient-to-r from-green-500 to-green-400 rounded" style={{ width: `${(t.total / maxRevenue) * 100}%` }} />
                </div>
                <span className="text-xs text-slate-400 w-16 text-right">¥{(t.total / 100).toFixed(0)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// 管理员反馈管理组件
function AdminFeedbackTab({ feedback, total, page, setPage, status, setStatus, loadFeedback, reply, setReply, showModal, setShowModal }) {
  const handleReply = async (id) => {
    if (!reply) return;
    try { await api.post(`/api/admin/feedback/${id}/reply`, { reply }); setShowModal(null); setReply(""); loadFeedback(); } catch (err) { console.error(err); }
  };
  return (
    <div className="space-y-6">
      <div className="bg-slate-900/50 border border-white/10 rounded-xl p-6">
        <div className="flex gap-4 mb-4">
          <select value={status} onChange={(e) => setStatus(e.target.value)} className="px-4 py-2 bg-slate-800 border border-white/10 rounded-lg">
            <option value="">全部</option><option value="pending">待处理</option><option value="processed">已处理</option><option value="resolved">已解决</option>
          </select>
        </div>
        {feedback.length === 0 ? <p className="text-slate-500 text-center py-8">暂无反馈</p> : (
          <div className="space-y-3">
            {feedback.map((f) => (
              <div key={f.id} className="p-4 bg-slate-800 rounded-lg">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-medium">{f.title}</span>
                  <span className={`px-2 py-0.5 rounded text-xs ${f.status === "pending" ? "bg-yellow-500/20 text-yellow-400" : f.status === "processed" ? "bg-blue-500/20 text-blue-400" : "bg-green-500/20 text-green-400"}`}>
                    {f.status === "pending" ? "待处理" : f.status === "processed" ? "已处理" : "已解决"}
                  </span>
                </div>
                <p className="text-sm text-slate-400 mb-1">{f.content}</p>
                <div className="text-xs text-slate-500 mb-2">用户：{f.username || "匿名"} · {new Date(f.created_at).toLocaleString("zh-CN")}</div>
                {f.admin_reply && <div className="text-sm text-green-400 border-t border-white/10 pt-2 mt-2"><span className="font-medium">回复：</span>{f.admin_reply}</div>}
                {f.status !== "resolved" && <button onClick={() => setShowModal(f.id)} className="mt-2 px-3 py-1 bg-blue-600 hover:bg-blue-500 rounded text-sm">回复</button>}
              </div>
            ))}
          </div>
        )}
        {total > 20 && <div className="flex justify-center gap-2 mt-4">
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="px-3 py-1 bg-slate-800 rounded disabled:opacity-50">上一页</button>
          <span className="px-3 py-1">第 {page} / {Math.ceil(total / 20)} 页</span>
          <button onClick={() => setPage(p => p + 1)} disabled={page * 20 >= total} className="px-3 py-1 bg-slate-800 rounded disabled:opacity-50">下一页</button>
        </div>}
      </div>
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-slate-900/50 border border-white/10 rounded-xl p-6 w-full max-w-md">
            <h3 className="text-lg font-bold mb-4">回复反馈</h3>
            <textarea value={reply} onChange={(e) => setReply(e.target.value)} placeholder="请输入回复内容" rows={4} className="w-full px-4 py-2 bg-slate-800 border border-white/10 rounded-lg mb-4" />
            <div className="flex gap-2">
              <button onClick={() => setShowModal(null)} className="flex-1 px-4 py-2 bg-slate-700 rounded-lg">取消</button>
              <button onClick={() => handleReply(showModal)} className="flex-1 px-4 py-2 bg-blue-600 rounded-lg">提交回复</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// 套餐配置组件
function PackagesTab({ packages, setPackages, setMessage }) {
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ name: "", quota_amount: "", price_cents: "", is_active: 1 });
  const handleSave = async () => {
    try {
      if (editing) { await api.put(`/api/admin/packages/${editing}`, form); }
      else { await api.post("/api/admin/packages", { ...form, sort_order: packages.length }); }
      const data = await api.get("/api/admin/packages");
      setPackages(data.packages || []);
      setEditing(null); setForm({ name: "", quota_amount: "", price_cents: "", is_active: 1 });
      setMessage({ type: "success", text: "保存成功" });
    } catch (err) { setMessage({ type: "error", text: err.message }); }
  };
  const handleDelete = async (id) => {
    if (!confirm("确定删除此套餐？")) return;
    try { await api.delete(`/api/admin/packages/${id}`); const data = await api.get("/api/admin/packages"); setPackages(data.packages || []); } catch (err) { setMessage({ type: "error", text: err.message }); }
  };
  return (
    <div className="space-y-6">
      <div className="bg-slate-900/50 border border-white/10 rounded-xl p-6">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-bold">套餐列表</h3>
          <button onClick={() => { setEditing(null); setForm({ name: "", quota_amount: "", price_cents: "", is_active: 1 }); }} className="px-3 py-1 bg-blue-600 rounded text-sm">新增套餐</button>
        </div>
        <div className="space-y-3">
          {packages.map((p) => (
            <div key={p.id} className="p-4 bg-slate-800 rounded-lg flex items-center justify-between">
              <div>
                <div className="font-medium">{p.name}</div>
                <div className="text-sm text-slate-400">{p.quota_amount} 次 · ¥{(p.price_cents / 100).toFixed(2)}</div>
              </div>
              <div className="flex gap-2">
                <button onClick={() => { setEditing(p.id); setForm({ name: p.name, quota_amount: p.quota_amount, price_cents: p.price_cents, is_active: p.is_active }); }} className="p-2 hover:bg-slate-700 rounded"><Edit className="w-4 h-4" /></button>
                <button onClick={() => handleDelete(p.id)} className="p-2 hover:bg-red-500/20 text-red-400 rounded"><Trash2 className="w-4 h-4" /></button>
              </div>
            </div>
          ))}
        </div>
      </div>
      {(editing || form.name) && (
        <div className="bg-slate-900/50 border border-white/10 rounded-xl p-6">
          <h3 className="text-lg font-bold mb-4">{editing ? "编辑套餐" : "新增套餐"}</h3>
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div><label className="block text-sm text-slate-400 mb-1">套餐名称</label><input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full px-4 py-2 bg-slate-800 border border-white/10 rounded-lg" /></div>
            <div><label className="block text-sm text-slate-400 mb-1">额度次数</label><input type="number" value={form.quota_amount} onChange={(e) => setForm({ ...form, quota_amount: e.target.value })} className="w-full px-4 py-2 bg-slate-800 border border-white/10 rounded-lg" /></div>
            <div><label className="block text-sm text-slate-400 mb-1">价格(分)</label><input type="number" value={form.price_cents} onChange={(e) => setForm({ ...form, price_cents: e.target.value })} className="w-full px-4 py-2 bg-slate-800 border border-white/10 rounded-lg" /></div>
            <div><label className="block text-sm text-slate-400 mb-1">状态</label><select value={form.is_active} onChange={(e) => setForm({ ...form, is_active: parseInt(e.target.value) })} className="w-full px-4 py-2 bg-slate-800 border border-white/10 rounded-lg"><option value={1}>启用</option><option value={0}>禁用</option></select></div>
          </div>
          <button onClick={handleSave} className="px-6 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg">保存</button>
        </div>
      )}
    </div>
  );
}

// 系统设置组件
function SystemSettingsTab({ settings, setSettings, setMessage }) {
  const [form, setForm] = useState(settings);
  const handleSave = async () => {
    try { await api.put("/api/admin/settings", form); setSettings(form); setMessage({ type: "success", text: "保存成功" }); } catch (err) { setMessage({ type: "error", text: err.message }); }
  };
  useEffect(() => { setForm(settings); }, [settings]);
  return (
    <div className="space-y-6">
      <div className="bg-slate-900/50 border border-white/10 rounded-xl p-6">
        <h3 className="text-lg font-bold mb-4">系统设置</h3>
        <div className="space-y-4">
          <div>
            <label className="block text-sm text-slate-400 mb-1">网站名称</label>
            <input type="text" value={form.site_name || ""} onChange={(e) => setForm({ ...form, site_name: e.target.value })} className="w-full px-4 py-2 bg-slate-800 border border-white/10 rounded-lg" />
            <p className="text-xs text-slate-500 mt-1">显示在网站导航栏的名称</p>
          </div>
          <div>
            <label className="block text-sm text-slate-400 mb-1">新用户免费额度</label>
            <input type="number" value={form.default_free_quota || ""} onChange={(e) => setForm({ ...form, default_free_quota: e.target.value })} className="w-full px-4 py-2 bg-slate-800 border border-white/10 rounded-lg" />
            <p className="text-xs text-slate-500 mt-1">新用户注册时赠送的免费分析次数（默认3次）</p>
          </div>
          <div>
            <label className="block text-sm text-slate-400 mb-1">维护模式</label>
            <select value={form.maintenance_mode || "false"} onChange={(e) => setForm({ ...form, maintenance_mode: e.target.value })} className="w-full px-4 py-2 bg-slate-800 border border-white/10 rounded-lg">
              <option value="false">关闭</option>
              <option value="true">开启</option>
            </select>
            <p className="text-xs text-slate-500 mt-1">开启后普通用户无法使用分析功能，仅管理员可访问</p>
          </div>
          <button onClick={handleSave} className="px-6 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg">保存设置</button>
        </div>
      </div>
    </div>
  );
}

// 站点内容管理组件
function SiteContentTab({ setMessage }) {
  const [content, setContent] = useState({ title: "", body: "", images: [] });
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = React.useRef(null);

  useEffect(() => {
    api.get("/api/admin/site-content/purchase_info").then((d) => {
      setContent({ title: d.title || "", body: d.body || "", images: d.images || [] });
    }).catch(() => {});
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.put("/api/admin/site-content/purchase_info", { title: content.title, body: content.body });
      setMessage({ type: "success", text: "内容已保存" });
    } catch (err) {
      setMessage({ type: "error", text: err.message });
    } finally {
      setSaving(false);
    }
  };

  const handleUploadImage = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (content.images.length >= 5) {
      setMessage({ type: "error", text: "最多上传 5 张图片" });
      return;
    }
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("image", file);
      const result = await api.post("/api/admin/site-content/purchase_info/image", formData);
      setContent({ ...content, images: result.images });
      setMessage({ type: "success", text: "图片上传成功" });
    } catch (err) {
      setMessage({ type: "error", text: err.message });
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleDeleteImage = async (imageUrl) => {
    try {
      const result = await api.delete("/api/admin/site-content/purchase_info/image", { imageUrl });
      setContent({ ...content, images: result.images || content.images.filter((img) => img !== imageUrl) });
      setMessage({ type: "success", text: "图片已删除" });
    } catch (err) {
      setMessage({ type: "error", text: err.message });
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-slate-900/50 border border-white/10 rounded-xl p-6">
        <h3 className="text-lg font-bold mb-4">购买说明内容管理</h3>
        <p className="text-sm text-slate-400 mb-4">此内容展示在"兑换额度"页面的购买说明区域</p>
        <div className="space-y-4">
          <div>
            <label className="block text-sm text-slate-400 mb-1">标题</label>
            <input
              type="text"
              value={content.title}
              onChange={(e) => setContent({ ...content, title: e.target.value })}
              placeholder="如：扫码添加管理员微信购买兑换码"
              className="w-full px-4 py-2 bg-slate-800 border border-white/10 rounded-lg text-white"
            />
          </div>
          <div>
            <label className="block text-sm text-slate-400 mb-1">正文（支持换行）</label>
            <textarea
              value={content.body}
              onChange={(e) => setContent({ ...content, body: e.target.value })}
              placeholder="如：微信号：xxx&#10;付款后管理员会发送兑换码"
              rows={4}
              className="w-full px-4 py-2 bg-slate-800 border border-white/10 rounded-lg text-white"
            />
          </div>
          <button onClick={handleSave} disabled={saving} className="px-6 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 rounded-lg flex items-center gap-2">
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}保存文字内容
          </button>
        </div>
      </div>

      <div className="bg-slate-900/50 border border-white/10 rounded-xl p-6">
        <h3 className="text-lg font-bold mb-4">图片管理（最多 5 张）</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4 mb-4">
          {content.images.map((img, i) => (
            <div key={i} className="relative group">
              <img src={img} alt={`图片${i + 1}`} className="w-full h-32 object-contain bg-white rounded-lg p-1" />
              <button
                onClick={() => handleDeleteImage(img)}
                className="absolute -top-2 -right-2 w-6 h-6 bg-red-500 hover:bg-red-400 rounded-full flex items-center justify-center text-white text-xs opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
          {content.images.length < 5 && (
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="w-full h-32 border-2 border-dashed border-white/10 hover:border-white/30 rounded-lg flex flex-col items-center justify-center gap-1 text-slate-500 hover:text-slate-300 transition-colors"
            >
              {uploading ? <Loader2 className="w-6 h-6 animate-spin" /> : <span className="text-2xl">+</span>}
              <span className="text-xs">上传图片</span>
            </button>
          )}
        </div>
        <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleUploadImage} />
        <p className="text-xs text-slate-500">支持 PNG、JPG 格式，单张最大 5MB</p>
      </div>

      {/* 预览 */}
      <div className="bg-slate-900/50 border border-white/10 rounded-xl p-6">
        <h3 className="text-lg font-bold mb-4">预览效果</h3>
        <div className="p-4 bg-slate-800/50 border border-white/10 rounded-xl">
          <div className="flex flex-col sm:flex-row items-center gap-4">
            {content.images.length > 0 && (
              <div className="flex gap-3 shrink-0">
                {content.images.map((img, i) => (
                  <img key={i} src={img} alt="" className="w-32 h-32 rounded-lg bg-white p-1 object-contain" />
                ))}
              </div>
            )}
            <div className="text-center sm:text-left">
              {content.title && <p className="text-white font-medium mb-1">{content.title}</p>}
              {content.body && content.body.split("\n").map((line, i) => (
                <p key={i} className="text-sm text-slate-400">{line}</p>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// 管理员面板组件
function AdminPanel({ tokenQuota, setTokenQuota, tokenCount, setTokenCount, generating, setGenerating, setGeneratedToken, setMessage, adminTokens, setAdminTokens, adminAvailable, setAdminAvailable, loading, setLoading }) {
  const [allTokens, setAllTokens] = useState([]);
  const [tokenPage, setTokenPage] = useState(1);
  const [generatedTokens, setGeneratedTokens] = useState([]);

  useEffect(() => {
    loadAllTokens();
  }, [tokenPage]);

  const loadAllTokens = async () => {
    try {
      const data = await api.get(`/api/admin/tokens?page=${tokenPage}&pageSize=50`);
      setAllTokens(data.tokens || []);
    } catch (err) {
      console.error("加载兑换码列表失败:", err);
    }
  };

  const handleGenerate = async () => {
    setGenerating(true); setMessage(null);
    try {
      const result = await api.post("/api/token/generate", { quotaAmount: tokenQuota, expireDays: 30, count: tokenCount });
      // API returns array for count > 1, single object for count = 1
      const tokens = Array.isArray(result) ? result : [result];
      setGeneratedTokens(tokens);
      setGeneratedToken(result);
      setMessage({ type: "success", text: `成功生成 ${tokens.length} 个兑换码` });
      loadAllTokens();
      const data = await api.get("/api/token/list");
      setAdminTokens(data.tokens || []); setAdminAvailable(data.available || 0);
    } catch (err) { setMessage({ type: "error", text: err.message || "生成失败" }); } finally { setGenerating(false); }
  };

  const handleDeleteToken = async (token) => {
    if (!confirm(`确定删除兑换码 ${token} 吗？删除后该兑换码将无法使用。`)) return;
    try {
      await api.delete(`/api/admin/tokens/${token}`);
      setMessage({ type: "success", text: "兑换码已删除" });
      loadAllTokens();
    } catch (err) {
      setMessage({ type: "error", text: err.message || "删除失败" });
    }
  };

  const copyToClipboard = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      setMessage({ type: "success", text: "已复制到剪贴板" });
    } catch (err) {
      // 降级方案
      const textArea = document.createElement("textarea");
      textArea.value = text;
      textArea.style.position = "fixed";
      textArea.style.left = "-999999px";
      document.body.appendChild(textArea);
      textArea.select();
      try {
        document.execCommand("copy");
        setMessage({ type: "success", text: "已复制到剪贴板" });
      } catch (e) {
        setMessage({ type: "error", text: "复制失败" });
      }
      document.body.removeChild(textArea);
    }
  };

  const copyAllTokens = async () => {
    const text = generatedTokens.map(t => t.token).join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setMessage({ type: "success", text: `已复制 ${generatedTokens.length} 个兑换码` });
    } catch (err) {
      // 降级方案
      const textArea = document.createElement("textarea");
      textArea.value = text;
      textArea.style.position = "fixed";
      textArea.style.left = "-999999px";
      document.body.appendChild(textArea);
      textArea.select();
      try {
        document.execCommand("copy");
        setMessage({ type: "success", text: `已复制 ${generatedTokens.length} 个兑换码` });
      } catch (e) {
        setMessage({ type: "error", text: "复制失败" });
      }
      document.body.removeChild(textArea);
    }
  };

  return (
    <div className="space-y-6">
      {/* 生成兑换码 */}
      <div className="bg-gray-900 border border-yellow-500/30 rounded-xl p-6">
        <h3 className="text-lg font-bold mb-4 text-yellow-400">生成兑换码</h3>
        <div className="flex gap-4 mb-4">
          <div><label className="block text-sm text-slate-400 mb-1">每个额度</label><select value={tokenQuota} onChange={(e) => setTokenQuota(parseInt(e.target.value))} className="px-4 py-2 bg-slate-800 border border-white/10 rounded-lg"><option value={1}>1 次</option><option value={5}>5 次</option><option value={10}>10 次</option><option value={30}>30 次</option><option value={50}>50 次</option></select></div>
          <div><label className="block text-sm text-slate-400 mb-1">生成数量</label><select value={tokenCount} onChange={(e) => setTokenCount(parseInt(e.target.value))} className="px-4 py-2 bg-slate-800 border border-white/10 rounded-lg"><option value={1}>1 个</option><option value={5}>5 个</option><option value={10}>10 个</option></select></div>
          <div className="flex-1 flex items-end"><button onClick={handleGenerate} disabled={generating} className="w-full px-6 py-2 bg-yellow-600 hover:bg-yellow-500 disabled:bg-slate-700 rounded-lg font-medium flex items-center justify-center gap-2">{generating && <Loader2 className="w-4 h-4 animate-spin" />}生成</button></div>
        </div>

        {/* 生成结果面板 */}
        {generatedTokens.length > 0 && (
          <div className="mt-4 p-4 bg-slate-800 rounded-lg border border-yellow-500/20">
            <div className="flex items-center justify-between mb-3">
              <div className="text-sm font-medium text-yellow-400">刚生成的兑换码（有效期30天）</div>
              <button onClick={copyAllTokens} className="flex items-center gap-1 px-3 py-1 bg-slate-700 hover:bg-slate-600 rounded text-sm">
                <Copy className="w-3 h-3" />全部复制
              </button>
            </div>
            <div className="space-y-2 max-h-60 overflow-y-auto">
              {generatedTokens.map((t, i) => (
                <div key={i} className="flex items-center gap-3 p-2 bg-gray-900 rounded">
                  <code className="flex-1 font-mono font-bold text-green-400">{t.token}</code>
                  <span className="text-xs text-slate-500">{t.quotaAmount} 次</span>
                  <button onClick={() => copyToClipboard(t.token)} className="p-1 hover:bg-slate-700 rounded"><Copy className="w-4 h-4 text-slate-400" /></button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 兑换码列表 */}
      <div className="bg-slate-900/50 border border-white/10 rounded-xl p-6">
        <h3 className="text-lg font-bold mb-4">兑换码列表</h3>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead><tr className="text-left text-sm text-slate-400 border-b border-white/10"><th className="pb-3">兑换码</th><th className="pb-3">额度</th><th className="pb-3">状态</th><th className="pb-3">过期时间</th><th className="pb-3">使用者</th><th className="pb-3">创建时间</th><th className="pb-3">操作</th></tr></thead>
            <tbody>{allTokens.map((t) => {
              const isUsed = t.used_at;
              const isExpired = new Date(t.expires_at) < new Date();
              return (
                <tr key={t.token} className="border-b border-white/10/50 text-sm">
                  <td className="py-3 font-mono font-medium">{t.token}</td>
                  <td className="py-3">{t.quota_amount} 次</td>
                  <td className="py-3"><span className={`px-2 py-0.5 rounded text-xs ${isUsed ? "bg-slate-500/20 text-slate-400" : isExpired ? "bg-red-500/20 text-red-400" : "bg-green-500/20 text-green-400"}`}>{isUsed ? "已使用" : isExpired ? "已过期" : "可用"}</span></td>
                  <td className="py-3 text-slate-400">{new Date(t.expires_at).toLocaleDateString("zh-CN")}</td>
                  <td className="py-3 text-slate-400">{t.used_by || "-"}</td>
                  <td className="py-3 text-slate-400">{new Date(t.created_at).toLocaleDateString("zh-CN")}</td>
                  <td className="py-3">
                    {!isUsed && <button onClick={() => handleDeleteToken(t.token)} className="p-1 hover:bg-red-500/20 text-red-400 rounded" title="删除"><Trash2 className="w-4 h-4" /></button>}
                  </td>
                </tr>
              );
            })}</tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
