import React, { useState } from "react";
import { CreditCard, X } from "lucide-react";
import api from "../../services/api";
import useAuthStore from "../../store/useAuthStore";

export default function PaymentModal() {
  const [channel, setChannel] = useState("wechat");
  const [amount, setAmount] = useState(10);
  const [loading, setLoading] = useState(false);
  const [orderInfo, setOrderInfo] = useState(null);
  const [error, setError] = useState("");

  const setRequirePayment = useAuthStore((s) => s.setRequirePayment);

  const handleCreateOrder = async () => {
    setError("");
    setLoading(true);
    try {
      const data = await api.post("/api/payment/create", {
        channel,
        quota_amount: amount,
      });
      setOrderInfo(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const prices = [
    { amount: 5, label: "5次", price: "49.50" },
    { amount: 10, label: "10次", price: "99.00" },
    { amount: 30, label: "30次", price: "297.00", tag: "热门" },
    { amount: 50, label: "50次", price: "495.00", tag: "超值" },
  ];

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-gray-900 border border-gray-700 rounded-2xl p-6 max-w-md w-full relative">
        <button
          onClick={() => setRequirePayment(false)}
          className="absolute top-4 right-4 text-gray-500 hover:text-white"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-2 mb-4">
          <CreditCard className="w-5 h-5 text-blue-400" />
          <h2 className="text-lg font-bold">购买分析额度</h2>
        </div>

        {!orderInfo ? (
          <>
            <div className="grid grid-cols-2 gap-3 mb-4">
              {prices.map((p) => (
                <button
                  key={p.amount}
                  onClick={() => setAmount(p.amount)}
                  className={`p-3 rounded-xl border text-center transition-all relative ${
                    amount === p.amount
                      ? "border-blue-500 bg-blue-500/10"
                      : "border-gray-700 hover:border-gray-600"
                  }`}
                >
                  {p.tag && (
                    <span className="absolute -top-2 right-2 text-[10px] bg-orange-500 text-white px-1.5 py-0.5 rounded-full">
                      {p.tag}
                    </span>
                  )}
                  <div className="font-bold text-lg">{p.label}</div>
                  <div className="text-sm text-gray-400">&yen;{p.price}</div>
                </button>
              ))}
            </div>

            <div className="flex gap-2 mb-4">
              <button
                onClick={() => setChannel("wechat")}
                className={`flex-1 py-2 rounded-lg text-sm font-medium border transition-all ${
                  channel === "wechat" ? "border-green-500 bg-green-500/10 text-green-400" : "border-gray-700"
                }`}
              >
                微信支付
              </button>
              <button
                onClick={() => setChannel("alipay")}
                className={`flex-1 py-2 rounded-lg text-sm font-medium border transition-all ${
                  channel === "alipay" ? "border-blue-500 bg-blue-500/10 text-blue-400" : "border-gray-700"
                }`}
              >
                支付宝
              </button>
            </div>

            {error && <p className="text-sm text-red-400 mb-3">{error}</p>}

            <button
              onClick={handleCreateOrder}
              disabled={loading}
              className="w-full py-2.5 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 rounded-lg font-medium transition-colors"
            >
              {loading ? "创建订单中..." : `支付 ¥${(amount * 9.9).toFixed(2)}`}
            </button>
          </>
        ) : (
          <div className="text-center py-4">
            <p className="text-sm text-gray-400 mb-2">请使用{channel === "wechat" ? "微信" : "支付宝"}扫码支付</p>
            <div className="w-48 h-48 mx-auto bg-white rounded-xl flex items-center justify-center mb-3">
              <p className="text-gray-500 text-xs">支付二维码</p>
            </div>
            <p className="text-xs text-gray-500">订单号：{orderInfo.order_no}</p>
          </div>
        )}
      </div>
    </div>
  );
}
