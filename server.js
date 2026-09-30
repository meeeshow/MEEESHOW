require("dotenv").config();
const express=require("express");
const session=require("express-session");
const bcrypt=require("bcryptjs");
const Database=require("better-sqlite3");
const path=require("path");
const crypto=require("crypto");
const Razorpay=require("razorpay");

const app=express();
const db=new Database("meeeshow.db");
const PORT=process.env.PORT||3000;
app.use(express.json({limit:"2mb"}));
app.use(express.urlencoded({extended:true}));
app.use(session({secret:process.env.SESSION_SECRET||"dev-secret-change-me",resave:false,saveUninitialized:false,cookie:{httpOnly:true,sameSite:"lax",secure:false}}));
app.use(express.static(path.join(__dirname,"public")));

db.exec(`
CREATE TABLE IF NOT EXISTS products(
 id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,category TEXT NOT NULL,
 price INTEGER NOT NULL,old_price INTEGER NOT NULL DEFAULT 0,discount INTEGER NOT NULL DEFAULT 0,
 emoji TEXT DEFAULT '📦',stock INTEGER NOT NULL DEFAULT 0,active INTEGER NOT NULL DEFAULT 1,
 created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS orders(
 id INTEGER PRIMARY KEY AUTOINCREMENT,customer_name TEXT NOT NULL,phone TEXT NOT NULL,
 address TEXT NOT NULL,total INTEGER NOT NULL,payment_status TEXT NOT NULL DEFAULT 'pending',
 order_status TEXT NOT NULL DEFAULT 'Pending',payment_id TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS order_items(
 id INTEGER PRIMARY KEY AUTOINCREMENT,order_id INTEGER NOT NULL,product_id INTEGER NOT NULL,
 name TEXT NOT NULL,price INTEGER NOT NULL,qty INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS admins(id INTEGER PRIMARY KEY AUTOINCREMENT,username TEXT UNIQUE NOT NULL,password_hash TEXT NOT NULL);
`);

const adminUser=process.env.ADMIN_USER||"admin";
const adminPass=process.env.ADMIN_PASSWORD||"change-me";
if(!db.prepare("SELECT 1 FROM admins WHERE username=?").get(adminUser)){
  db.prepare("INSERT INTO admins(username,password_hash) VALUES(?,?)").run(adminUser,bcrypt.hashSync(adminPass,12));
}
if(db.prepare("SELECT COUNT(*) c FROM products").get().c===0){
 const seed=[
 ["Women's Cotton Kurta (Printed)","Fashion",399,999,60,"👗",42],
 ["boAt Airdopes 141 (Black)","Electronics",1299,4090,70,"🎧",18],
 ["Stainless Steel Water Bottle (750ml)","Home & Living",299,599,50,"🧴",65],
 ["Fire-Boltt Smart Watch (Black)","Electronics",1899,4999,62,"⌚",11],
 ["Curtain Set (Pack of 2)","Home & Living",499,1099,55,"🪟",28],
 ["Non-Stick Cookware Set (5 Pieces)","Kitchen",1299,3099,58,"🍳",9]
 ];
 const ins=db.prepare("INSERT INTO products(name,category,price,old_price,discount,emoji,stock) VALUES(?,?,?,?,?,?,?)");
 const tx=db.transaction(()=>seed.forEach(x=>ins.run(...x)));tx();
}

function admin(req,res,next){if(req.session.admin)return next();res.status(401).json({error:"Unauthorized"});}
function safeProduct(p){return {...p,active:!!p.active};}

app.get("/api/products",(req,res)=>{
 const q=(req.query.q||"").trim().toLowerCase(),cat=req.query.category||"All";
 let sql="SELECT * FROM products WHERE active=1",args=[];
 if(cat!=="All"){sql+=" AND category=?";args.push(cat)}
 if(q){sql+=" AND (LOWER(name) LIKE ? OR LOWER(category) LIKE ?)";args.push("%"+q+"%","%"+q+"%")}
 sql+=" ORDER BY id DESC";
 res.json(db.prepare(sql).all(...args).map(safeProduct));
});

app.get("/api/admin/session",(req,res)=>res.json({loggedIn:!!req.session.admin,username:req.session.admin?.username||null}));
app.post("/api/admin/login",(req,res)=>{
 const row=db.prepare("SELECT * FROM admins WHERE username=?").get(req.body.username||"");
 if(!row||!bcrypt.compareSync(req.body.password||"",row.password_hash))return res.status(401).json({error:"Invalid username or password"});
 req.session.admin={id:row.id,username:row.username};res.json({ok:true});
});
app.post("/api/admin/logout",(req,res)=>req.session.destroy(()=>res.json({ok:true})));

app.get("/api/admin/products",admin,(req,res)=>res.json(db.prepare("SELECT * FROM products ORDER BY id DESC").all().map(safeProduct)));
app.post("/api/admin/products",admin,(req,res)=>{
 const {name,category,price,old_price,discount,emoji,stock}=req.body;
 if(!name||!category||!Number(price))return res.status(400).json({error:"Name, category and price are required"});
 const r=db.prepare("INSERT INTO products(name,category,price,old_price,discount,emoji,stock) VALUES(?,?,?,?,?,?,?)").run(name,category,+price,+old_price||+price,+discount||0,emoji||"📦",+stock||0);
 res.json({id:r.lastInsertRowid});
});
app.put("/api/admin/products/:id",admin,(req,res)=>{
 const {name,category,price,old_price,discount,emoji,stock,active}=req.body;
 db.prepare("UPDATE products SET name=?,category=?,price=?,old_price=?,discount=?,emoji=?,stock=?,active=? WHERE id=?")
 .run(name,category,+price,+old_price||+price,+discount||0,emoji||"📦",+stock||0,active?1:0,+req.params.id);
 res.json({ok:true});
});
app.delete("/api/admin/products/:id",admin,(req,res)=>{db.prepare("DELETE FROM products WHERE id=?").run(+req.params.id);res.json({ok:true})});

app.post("/api/orders", (req,res)=>{
 const {customer_name,phone,address,items}=req.body;
 if(!customer_name||!phone||!address||!Array.isArray(items)||!items.length)return res.status(400).json({error:"Missing order details"});
 let total=0,rows=[];
 for(const i of items){
   const p=db.prepare("SELECT * FROM products WHERE id=? AND active=1").get(+i.id);
   const qty=Math.max(1,Math.floor(+i.qty||1));
   if(!p||p.stock<qty)return res.status(400).json({error:"Product unavailable or insufficient stock"});
   total+=p.price*qty;rows.push({p,qty});
 }
 const tx=db.transaction(()=>{
   const r=db.prepare("INSERT INTO orders(customer_name,phone,address,total) VALUES(?,?,?,?)").run(customer_name,phone,address,total);
   const ins=db.prepare("INSERT INTO order_items(order_id,product_id,name,price,qty) VALUES(?,?,?,?,?)");
   const upd=db.prepare("UPDATE products SET stock=stock-? WHERE id=?");
   rows.forEach(x=>{ins.run(r.lastInsertRowid,x.p.id,x.p.name,x.p.price,x.qty);upd.run(x.qty,x.p.id)});
   return r.lastInsertRowid;
 });
 const orderId=tx();res.json({orderId,total,paymentRequired:true});
});

app.get("/api/admin/orders",admin,(req,res)=>{
 const orders=db.prepare("SELECT * FROM orders ORDER BY id DESC").all();
 for(const o of orders)o.items=db.prepare("SELECT * FROM order_items WHERE order_id=?").all(o.id);
 res.json(orders);
});
app.put("/api/admin/orders/:id/status",admin,(req,res)=>{
 const allowed=["Pending","Processing","Shipped","Delivered","Cancelled"];
 if(!allowed.includes(req.body.status))return res.status(400).json({error:"Invalid status"});
 db.prepare("UPDATE orders SET order_status=? WHERE id=?").run(req.body.status,+req.params.id);res.json({ok:true});
});

app.post("/api/payment/order",async(req,res)=>{
 if(!process.env.RAZORPAY_KEY_ID||!process.env.RAZORPAY_KEY_SECRET)return res.status(503).json({error:"Payment gateway is not configured yet"});
 const {orderId}=req.body;
 const o=db.prepare("SELECT * FROM orders WHERE id=?").get(+orderId);
 if(!o)return res.status(404).json({error:"Order not found"});
 const razorpay=new Razorpay({key_id:process.env.RAZORPAY_KEY_ID,key_secret:process.env.RAZORPAY_KEY_SECRET});
 try{
   const rp=await razorpay.orders.create({amount:o.total*100,currency:"INR",receipt:"MS"+o.id,payment_capture:1});
   res.json({keyId:process.env.RAZORPAY_KEY_ID,razorpayOrderId:rp.id,amount:rp.amount,currency:rp.currency});
 }catch(e){res.status(500).json({error:"Could not create payment order"});}
});

app.post("/api/payment/verify",(req,res)=>{
 const {orderId,razorpay_order_id,razorpay_payment_id,razorpay_signature}=req.body;
 const body=razorpay_order_id+"|"+razorpay_payment_id;
 const expected=crypto.createHmac("sha256",process.env.RAZORPAY_KEY_SECRET||"").update(body).digest("hex");
 if(!process.env.RAZORPAY_KEY_SECRET||expected!==razorpay_signature)return res.status(400).json({error:"Payment verification failed"});
 db.prepare("UPDATE orders SET payment_status='paid',payment_id=? WHERE id=?").run(razorpay_payment_id,+orderId);
 res.json({ok:true});
});

app.get("/api/admin/stats",admin,(req,res)=>{
 const sales=db.prepare("SELECT COALESCE(SUM(total),0) s FROM orders WHERE payment_status='paid'").get().s;
 const orders=db.prepare("SELECT COUNT(*) c FROM orders").get().c;
 const products=db.prepare("SELECT COUNT(*) c FROM products WHERE active=1").get().c;
 res.json({sales,orders,products});
});

app.get("*",(req,res)=>res.sendFile(path.join(__dirname,"public","index.html")));
app.listen(PORT,()=>console.log("Meeeshow running on http://localhost:"+PORT));
