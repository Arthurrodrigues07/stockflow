
"use strict";

const STORAGE_KEY="stockflow_v1";
const MAX_QUANTITY=999999999;
const MAX_MONEY=999999999;
const $=id=>document.getElementById(id);
const money=value=>new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"}).format(value);
const number=value=>new Intl.NumberFormat("pt-BR").format(value);
const uid=()=>crypto.randomUUID?crypto.randomUUID():`${Date.now()}-${Math.random().toString(36).slice(2)}`;
const today=()=>new Date().toISOString();
const dateLabel=value=>new Date(value).toLocaleString("pt-BR",{dateStyle:"short",timeStyle:"short"});
const dayKey=value=>{const d=new Date(value);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`};
const validMoney=value=>typeof value==="number"&&Number.isFinite(value)&&value>=0&&value<=MAX_MONEY;
const validQuantity=value=>Number.isSafeInteger(value)&&value>=0&&value<=MAX_QUANTITY;
const escapeHTML=value=>String(value).replace(/[&<>"']/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
const emptyRow=(columns,message)=>`<tr><td colspan="${columns}" class="empty-message">${escapeHTML(message)}</td></tr>`;

let state={products:[],sales:[],movements:[]};
let cart=[];
let confirmCallback=null;
let lastFocus=null;

function validateState(data){
if(!data||typeof data!=="object"||Array.isArray(data))throw Error("Formato de backup inválido.");
for(const key of ["products","sales","movements"])if(!Array.isArray(data[key])||data[key].length>100000)throw Error(`Lista ${key} inválida.`);
const ids=new Set();
const codes=new Set();
for(const p of data.products){
if(!p||typeof p.id!=="string"||!p.id||ids.has(p.id)||typeof p.name!=="string"||!p.name.trim()||p.name.length>100||typeof p.code!=="string"||!p.code.trim()||p.code.length>40||typeof p.category!=="string"||!p.category.trim()||p.category.length>60||!validMoney(p.cost)||!validMoney(p.price)||!validQuantity(p.quantity)||!validQuantity(p.minStock))throw Error("Produto inválido no backup.");
ids.add(p.id);
const code=p.code.trim().toLowerCase();
if(codes.has(code))throw Error("Existem códigos de produtos duplicados.");
codes.add(code);
}
const saleIds=new Set();
for(const s of data.sales){
if(!s||typeof s.id!=="string"||!s.id||saleIds.has(s.id)||typeof s.date!=="string"||!Number.isFinite(Date.parse(s.date))||!Array.isArray(s.items)||!s.items.length||s.items.length>10000||!validMoney(s.total))throw Error("Venda inválida no backup.");
saleIds.add(s.id);
let sum=0;
for(const item of s.items){
if(!item||typeof item.productId!=="string"||typeof item.name!=="string"||!item.name.trim()||item.name.length>100||!validQuantity(item.quantity)||item.quantity===0||!validMoney(item.price)||!validMoney(item.cost))throw Error("Item de venda inválido.");
sum+=Math.round(item.price*100)*item.quantity;
}
if(!Number.isSafeInteger(sum)||Math.abs(sum-Math.round(s.total*100))>1)throw Error("Total de venda inconsistente.");
}
const movementIds=new Set();
for(const m of data.movements){
if(!m||typeof m.id!=="string"||!m.id||movementIds.has(m.id)||typeof m.productId!=="string"||typeof m.productName!=="string"||!m.productName.trim()||typeof m.date!=="string"||!Number.isFinite(Date.parse(m.date))||!["entry","exit","adjustment","sale","initial"].includes(m.type)||!validQuantity(m.quantity)||typeof m.note!=="string"||m.note.length>300)throw Error("Movimentação inválida.");
movementIds.add(m.id);
}
return true;
}

function loadState(){
try{
const saved=localStorage.getItem(STORAGE_KEY);
if(saved){
const parsed=JSON.parse(saved);
validateState(parsed);
state=parsed;
}
}catch(error){
console.error("Falha ao carregar dados:",error);
toast("Não foi possível carregar os dados locais. Nenhuma alteração foi salva.",true);
}
}

function saveState(next){
validateState(next);
try{
localStorage.setItem(STORAGE_KEY,JSON.stringify(next));
state=next;
return true;
}catch(error){
console.error("Falha ao salvar:",error);
toast("Não foi possível salvar. Verifique o espaço disponível no navegador.",true);
return false;
}
}

function toast(message,error=false){
const el=document.createElement("div");
el.className=`toast${error?" error":""}`;
el.textContent=message;
$("toastContainer").appendChild(el);
setTimeout(()=>el.remove(),4000);
}

function openModal(id){
lastFocus=document.activeElement;
$(id).classList.remove("hidden");
document.body.classList.add("modal-open");
const focusable=$(id).querySelector("input:not([type=hidden]),select,button");
focusable?.focus();
}

function closeModal(id){
$(id).classList.add("hidden");
if(!document.querySelector(".modal-backdrop:not(.hidden)"))document.body.classList.remove("modal-open");
if(id==="confirmModal")confirmCallback=null;
lastFocus?.focus();
}

function confirmAction(message,callback){
$("confirmMessage").textContent=message;
confirmCallback=callback;
openModal("confirmModal");
}

function navigate(page){
const section=$(`page-${page}`);
if(!section)return;
document.querySelectorAll(".page").forEach(el=>el.classList.remove("active"));
section.classList.add("active");
document.querySelectorAll(".nav-link").forEach(el=>el.classList.toggle("active",el.dataset.page===page));
const titles={dashboard:"Dashboard",products:"Produtos",inventory:"Estoque",sales:"Nova venda",history:"Histórico de vendas",reports:"Relatórios",settings:"Configurações"};
$("breadcrumbTitle").textContent=titles[page];
$("sidebar").classList.remove("open");
$("sidebarOverlay").classList.remove("active");
renderAll();
window.scrollTo({top:0,behavior:"instant"});
}

function stockStatus(p){
if(p.quantity===0)return "out";
if(p.quantity<=p.minStock)return "low";
return "normal";
}

function statusBadge(p){
const status=stockStatus(p);
const labels={normal:"Normal",low:"Estoque baixo",out:"Esgotado"};
return `<span class="status-badge status-${status}">${labels[status]}</span>`;
}

function productById(id){return state.products.find(p=>p.id===id)}
function productName(p){return escapeHTML(p.name)}
function cents(value){return Math.round(value*100)}
function amount(value){return Math.round(value)/100}
function cloneState(){return structuredClone(state)}

function openProduct(id=null){
$("productForm").reset();
$("productId").value="";
$("productQuantity").disabled=false;
$("productMinStock").value=5;
$("productModalTitle").textContent=id?"Editar produto":"Novo produto";
if(id){
const p=productById(id);
if(!p)return;
$("productId").value=p.id;
$("productName").value=p.name;
$("productCode").value=p.code;
$("productCategory").value=p.category;
$("productCost").value=p.cost;
$("productPrice").value=p.price;
$("productQuantity").value=p.quantity;
$("productQuantity").disabled=true;
$("productMinStock").value=p.minStock;
}
openModal("productModal");
}

function saveProduct(event){
event.preventDefault();
const id=$("productId").value;
const name=$("productName").value.trim();
const code=$("productCode").value.trim();
const category=$("productCategory").value.trim();
const cost=Number($("productCost").value);
const price=Number($("productPrice").value);
const quantity=Number($("productQuantity").value);
const minStock=Number($("productMinStock").value);
if(!name||name.length>100||!code||code.length>40||!category||category.length>60||!validMoney(cost)||!validMoney(price)||!validQuantity(quantity)||!validQuantity(minStock)){
toast("Verifique os dados do produto.",true);return;
}
if(state.products.some(p=>p.code.toLowerCase()===code.toLowerCase()&&p.id!==id)){
toast("Já existe um produto com esse código.",true);return;
}
const next=cloneState();
if(id){
const p=next.products.find(item=>item.id===id);
if(!p)return;
Object.assign(p,{name,code,category,cost,price,minStock});
}else{
const newId=uid();
next.products.push({id:newId,name,code,category,cost,price,quantity,minStock});
if(quantity>0)next.movements.unshift({id:uid(),productId:newId,productName:name,type:"initial",quantity,date:today(),note:"Estoque inicial"});
}
if(!saveState(next))return;
closeModal("productModal");
renderAll();
toast(id?"Produto atualizado com sucesso.":"Produto cadastrado com sucesso.");
}

function deleteProduct(id){
const p=productById(id);
if(!p)return;
if(state.sales.some(s=>s.items.some(item=>item.productId===id))){
toast("Este produto possui vendas registradas e não pode ser excluído.",true);return;
}
confirmAction(`Deseja excluir o produto "${p.name}"? Essa ação não pode ser desfeita.`,()=>{
const next=cloneState();
next.products=next.products.filter(item=>item.id!==id);
next.movements=next.movements.filter(m=>m.productId!==id);
if(saveState(next)){
cart=cart.filter(item=>item.productId!==id);
renderAll();
toast("Produto excluído.");
}
});
}

function renderProducts(){
const search=$("productSearch").value.trim().toLowerCase();
const category=$("productCategoryFilter").value;
const categories=[...new Set(state.products.map(p=>p.category))].sort((a,b)=>a.localeCompare(b,"pt-BR"));
$("productCategoryFilter").replaceChildren(new Option("Todas as categorias","all"),...categories.map(c=>new Option(c,c)));
$("productCategoryFilter").value=categories.includes(category)?category:"all";
const filtered=state.products.filter(p=>(`${p.name} ${p.code} ${p.category}`.toLowerCase().includes(search))&&($("productCategoryFilter").value==="all"||p.category===$("productCategoryFilter").value));
$("productCount").textContent=`${filtered.length} produto${filtered.length===1?"":"s"}`;
$("productsTableBody").innerHTML=filtered.length?filtered.map(p=>`<tr>
<td class="table-product-name">${productName(p)}</td>
<td>${escapeHTML(p.code)}</td><td>${escapeHTML(p.category)}</td>
<td>${money(p.cost)}</td><td>${money(p.price)}</td><td>${number(p.quantity)}</td>
<td>${statusBadge(p)}</td>
<td><div class="table-actions"><button class="action-button" data-action="edit-product" data-id="${escapeHTML(p.id)}" title="Editar" aria-label="Editar produto">✎</button><button class="action-button danger" data-action="delete-product" data-id="${escapeHTML(p.id)}" title="Excluir" aria-label="Excluir produto">×</button></div></td>
</tr>`).join(""):emptyRow(8,"Nenhum produto encontrado.");
}

function openMovement(id=null){
$("movementForm").reset();
$("movementProduct").replaceChildren(new Option("Selecione um produto",""),...state.products.map(p=>new Option(`${p.name} (${p.quantity} un.)`,p.id)));
if(id)$("movementProduct").value=id;
$("movementType").value="entry";
updateMovementHelp();
openModal("movementModal");
}

function updateMovementHelp(){
const type=$("movementType").value;
$("movementHelp").textContent={
entry:"Informe quantas unidades entrarão no estoque.",
exit:"Informe quantas unidades sairão do estoque.",
adjustment:"Informe a nova quantidade total que deverá ficar no estoque."
}[type];
$("movementQuantity").min=type==="adjustment"?"0":"1";
}

function saveMovement(event){
event.preventDefault();
const id=$("movementProduct").value;
const type=$("movementType").value;
const quantity=Number($("movementQuantity").value);
const note=$("movementNote").value.trim();
const product=productById(id);
if(!product||!["entry","exit","adjustment"].includes(type)||!validQuantity(quantity)||(type!=="adjustment"&&quantity===0)||note.length>300){
toast("Verifique os dados da movimentação.",true);return;
}
let final=type==="entry"?product.quantity+quantity:type==="exit"?product.quantity-quantity:quantity;
if(!validQuantity(final)){
toast("Quantidade inválida ou estoque insuficiente.",true);return;
}
const next=cloneState();
next.products.find(p=>p.id===id).quantity=final;
next.movements.unshift({id:uid(),productId:id,productName:product.name,type,quantity,date:today(),note});
if(!saveState(next))return;
closeModal("movementModal");
renderAll();
toast("Movimentação registrada com sucesso.");
}

function renderInventory(){
const products=state.products;
$("inventoryUnits").textContent=number(products.reduce((sum,p)=>sum+p.quantity,0));
$("inventoryLow").textContent=number(products.filter(p=>stockStatus(p)==="low").length);
$("inventoryOut").textContent=number(products.filter(p=>stockStatus(p)==="out").length);
const search=$("inventorySearch").value.trim().toLowerCase();
const status=$("inventoryStatusFilter").value;
const filtered=products.filter(p=>(`${p.name} ${p.code}`.toLowerCase().includes(search))&&(status==="all"||stockStatus(p)===status));
$("inventoryTableBody").innerHTML=filtered.length?filtered.map(p=>`<tr><td class="table-product-name">${productName(p)}</td><td>${escapeHTML(p.code)}</td><td>${number(p.quantity)}</td><td>${number(p.minStock)}</td><td>${statusBadge(p)}</td><td><button class="btn btn-outline" data-action="move-product" data-id="${escapeHTML(p.id)}" type="button">Movimentar</button></td></tr>`).join(""):emptyRow(6,"Nenhum produto encontrado.");
const labels={entry:"Entrada",exit:"Saída",adjustment:"Ajuste",sale:"Venda",initial:"Inicial"};
$("movementsTableBody").innerHTML=state.movements.length?state.movements.slice(0,100).map(m=>`<tr><td>${dateLabel(m.date)}</td><td>${escapeHTML(m.productName)}</td><td><span class="type-badge type-${["entry","initial"].includes(m.type)?"entry":["exit","sale"].includes(m.type)?"exit":"adjustment"}">${labels[m.type]}</span></td><td>${number(m.quantity)}</td><td>${escapeHTML(m.note||"—")}</td></tr>`).join(""):emptyRow(5,"Nenhuma movimentação registrada.");
}

function availableInCart(id){
const p=productById(id);
const item=cart.find(i=>i.productId===id);
return p?p.quantity-(item?.quantity||0):0;
}

function addToCart(id){
const p=productById(id);
if(!p||availableInCart(id)<=0){toast("Produto sem estoque disponível.",true);return;}
const item=cart.find(i=>i.productId===id);
if(item)item.quantity++;
else cart.push({productId:id,quantity:1});
renderSales();
toast("Produto adicionado ao carrinho.");
}

function changeCartQuantity(id,delta){
const item=cart.find(i=>i.productId===id);
if(!item)return;
if(delta>0&&availableInCart(id)<=0){toast("Quantidade máxima disponível atingida.",true);return;}
item.quantity+=delta;
if(item.quantity<=0)cart=cart.filter(i=>i.productId!==id);
renderSales();
}

function renderSales(){
cart=cart.filter(i=>productById(i.productId)&&i.quantity>0);
const search=$("saleProductSearch").value.trim().toLowerCase();
const products=state.products.filter(p=>`${p.name} ${p.code}`.toLowerCase().includes(search));
$("saleProductsList").innerHTML=products.length?products.map(p=>`<div class="sale-product"><div class="sale-product-info"><strong>${productName(p)}</strong><small>${escapeHTML(p.code)} · ${number(p.quantity)} unidade(s) disponíveis</small></div><div class="sale-product-price"><strong>${money(p.price)}</strong><button class="btn btn-primary" data-action="add-cart" data-id="${escapeHTML(p.id)}" ${availableInCart(p.id)<=0?"disabled":""} type="button">Adicionar</button></div></div>`).join(""):`<p class="empty-message">${state.products.length?"Nenhum produto encontrado.":"Cadastre produtos para começar a vender."}</p>`;
let totalCents=0;
let totalItems=0;
$("cartItems").innerHTML=cart.length?cart.map(item=>{
const p=productById(item.productId);
const itemCents=cents(p.price)*item.quantity;
totalCents+=itemCents;
totalItems+=item.quantity;
return `<div class="cart-item"><div class="cart-item-header"><div><strong>${productName(p)}</strong><small>${money(p.price)} por unidade</small></div><button class="action-button danger" data-action="remove-cart" data-id="${escapeHTML(p.id)}" aria-label="Remover item">×</button></div><div class="cart-item-controls"><div class="quantity-control"><button data-action="decrease-cart" data-id="${escapeHTML(p.id)}" type="button" aria-label="Diminuir quantidade">−</button><span>${number(item.quantity)}</span><button data-action="increase-cart" data-id="${escapeHTML(p.id)}" type="button" aria-label="Aumentar quantidade">+</button></div><strong class="cart-item-total">${money(amount(itemCents))}</strong></div></div>`;
}).join(""):'<p class="empty-message">Nenhum produto adicionado.</p>';
$("cartQuantity").textContent=number(totalItems);
$("cartTotal").textContent=money(amount(totalCents));
$("finishSaleButton").disabled=cart.length===0;
$("clearCartButton").disabled=cart.length===0;
}

function finishSale(){
if(!cart.length){toast("Adicione produtos antes de finalizar.",true);return;}
const items=[];
let totalCents=0;
for(const item of cart){
const p=productById(item.productId);
if(!p||item.quantity>p.quantity||!validQuantity(item.quantity)){
toast("Estoque insuficiente. Confira o carrinho.",true);return;
}
const itemCents=cents(p.price)*item.quantity;
totalCents+=itemCents;
items.push({productId:p.id,name:p.name,quantity:item.quantity,price:p.price,cost:p.cost});
}
if(!Number.isSafeInteger(totalCents)||totalCents/100>MAX_MONEY){
toast("O valor da venda excede o limite permitido.",true);return;
}
confirmAction(`Finalizar venda de ${money(amount(totalCents))}? O estoque será atualizado automaticamente.`,()=>{
const next=cloneState();
const saleId=uid();
const date=today();
for(const item of items){
const p=next.products.find(p=>p.id===item.productId);
p.quantity-=item.quantity;
next.movements.unshift({id:uid(),productId:p.id,productName:p.name,type:"sale",quantity:item.quantity,date,note:`Venda ${saleId.slice(0,8).toUpperCase()}`});
}
next.sales.unshift({id:saleId,date,items,total:amount(totalCents)});
if(!saveState(next))return;
cart=[];
renderAll();
toast("Venda finalizada com sucesso.");
});
}

function filteredSales(){
const search=$("salesSearch").value.trim().toLowerCase();
const start=$("salesStartDate").value;
const end=$("salesEndDate").value;
return state.sales.filter(s=>{
const date=dayKey(s.date);
return (!start||date>=start)&&(!end||date<=end)&&(`${s.id} ${s.items.map(i=>i.name).join(" ")}`.toLowerCase().includes(search));
});
}

function renderHistory(){
const sales=filteredSales();
$("salesHistoryBody").innerHTML=sales.length?sales.map(s=>`<tr><td><strong>#${escapeHTML(s.id.slice(0,8).toUpperCase())}</strong></td><td>${dateLabel(s.date)}</td><td>${number(s.items.reduce((sum,i)=>sum+i.quantity,0))}</td><td><strong>${money(s.total)}</strong></td><td><button class="btn btn-outline" data-action="sale-details" data-id="${escapeHTML(s.id)}" type="button">Ver detalhes</button></td></tr>`).join(""):emptyRow(5,"Nenhuma venda encontrada.");
}

function showSaleDetails(id){
const sale=state.sales.find(s=>s.id===id);
if(!sale)return;
$("saleDetailsTitle").textContent=`Venda #${sale.id.slice(0,8).toUpperCase()}`;
$("saleDetailsDate").textContent=dateLabel(sale.date);
$("saleDetailsContent").innerHTML=sale.items.map(i=>`<div class="sale-detail-item"><div><strong>${escapeHTML(i.name)}</strong><small>${number(i.quantity)} × ${money(i.price)}</small></div><strong>${money(amount(cents(i.price)*i.quantity))}</strong></div>`).join("")+`<div class="sale-detail-total"><span>Total</span><strong>${money(sale.total)}</strong></div>`;
openModal("saleDetailsModal");
}

function renderDashboard(){
const revenueCents=state.sales.reduce((sum,s)=>sum+cents(s.total),0);
$("statRevenue").textContent=money(amount(revenueCents));
$("statSales").textContent=number(state.sales.length);
$("statProducts").textContent=number(state.products.length);
$("statLowStock").textContent=number(state.products.filter(p=>stockStatus(p)!=="normal").length);
const normal=state.products.filter(p=>stockStatus(p)==="normal").length;
const low=state.products.filter(p=>stockStatus(p)==="low").length;
const out=state.products.filter(p=>stockStatus(p)==="out").length;
const count=state.products.length;
$("inventorySummary").innerHTML=count?`<div class="inventory-summary-row"><span>Produtos com estoque normal</span><strong>${normal} de ${count}</strong></div><div class="summary-bar"><div class="summary-bar-fill" style="width:${normal/count*100}%"></div></div><div class="summary-legend"><span><i class="legend-dot legend-normal"></i>Normal: ${normal}</span><span><i class="legend-dot legend-low"></i>Baixo: ${low}</span><span><i class="legend-dot legend-out"></i>Esgotado: ${out}</span></div>`:'<p class="empty-message">Nenhum produto cadastrado.</p>';
$("recentSales").innerHTML=state.sales.length?state.sales.slice(0,5).map(s=>`<div class="recent-sale"><div><strong>Venda #${escapeHTML(s.id.slice(0,8).toUpperCase())}</strong><small>${dateLabel(s.date)}</small></div><span class="recent-sale-value">${money(s.total)}</span></div>`).join(""):'<p class="empty-message">Nenhuma venda registrada.</p>';
const alerts=state.products.filter(p=>stockStatus(p)!=="normal").sort((a,b)=>a.quantity-b.quantity);
$("stockAlerts").innerHTML=alerts.length?alerts.slice(0,5).map(p=>`<div class="stock-alert"><div><strong>${productName(p)}</strong><small>${escapeHTML(p.code)}</small></div><span class="stock-alert-value">${p.quantity===0?"Esgotado":`${number(p.quantity)} un.`}</span></div>`).join(""):'<p class="empty-message">Nenhum alerta no momento.</p>';
renderBarChart("revenueChart",dailyRevenue(7),"Sem vendas nos últimos sete dias.");
}

function dailyRevenue(days,sales=state.sales){
const result=[];
const now=new Date();
for(let i=days-1;i>=0;i--){
const d=new Date(now.getFullYear(),now.getMonth(),now.getDate()-i);
const key=dayKey(d);
const total=sales.filter(s=>dayKey(s.date)===key).reduce((sum,s)=>sum+cents(s.total),0);
result.push({label:d.toLocaleDateString("pt-BR",{day:"2-digit",month:"2-digit"}),value:amount(total)});
}
return result;
}

function renderBarChart(id,data,emptyMessage){
const container=$(id);
if(!data.length||data.every(d=>d.value===0)){
container.innerHTML=`<p class="empty-message">${escapeHTML(emptyMessage)}</p>`;
return;
}
const max=Math.max(...data.map(d=>d.value),1);
const width=640,height=250,pad=35,plotHeight=185;
const gap=10;
const barWidth=Math.max(3,(width-pad*2)/data.length-gap);
const bars=data.map((d,i)=>{
const x=pad+i*(width-pad*2)/data.length+gap/2;
const barHeight=d.value/max*plotHeight;
const y=height-35-barHeight;
const showLabel=data.length<=12||i%Math.ceil(data.length/10)===0;
return `<rect x="${x}" y="${y}" width="${barWidth}" height="${barHeight}" rx="4" fill="#2563eb"><title>${escapeHTML(d.label)}: ${money(d.value)}</title></rect>${showLabel?`<text x="${x+barWidth/2}" y="${height-12}" text-anchor="middle" font-size="10" fill="#94a3b8">${escapeHTML(d.label)}</text>`:""}`;
}).join("");
container.innerHTML=`<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Gráfico de faturamento"><line x1="${pad}" y1="${height-35}" x2="${width-pad}" y2="${height-35}" stroke="#e5eaf1"/><text x="${pad}" y="16" font-size="11" fill="#64748b">${money(max)}</text>${bars}</svg>`;
}

function reportSales(){
const period=$("reportPeriod").value;
if(period==="all")return state.sales;
const days=Number(period);
const start=new Date();
start.setHours(0,0,0,0);
start.setDate(start.getDate()-(days-1));
return state.sales.filter(s=>new Date(s.date)>=start);
}

function renderReports(){
const sales=reportSales();
const revenueCents=sales.reduce((sum,s)=>sum+cents(s.total),0);
const costCents=sales.reduce((sum,s)=>sum+s.items.reduce((subtotal,i)=>subtotal+cents(i.cost)*i.quantity,0),0);
const profitCents=revenueCents-costCents;
$("reportRevenue").textContent=money(amount(revenueCents));
$("reportProfit").textContent=money(amount(profitCents));
$("reportSalesCount").textContent=number(sales.length);
$("reportAverage").textContent=money(sales.length?amount(revenueCents)/sales.length:0);
$("summaryRevenue").textContent=money(amount(revenueCents));
$("summaryCosts").textContent=money(amount(costCents));
$("summaryProfit").textContent=money(amount(profitCents));
const period=$("reportPeriod").value;
if(period==="all"){
const grouped=new Map();
for(const s of sales){
const key=dayKey(s.date);
grouped.set(key,(grouped.get(key)||0)+cents(s.total));
}
const data=[...grouped].sort((a,b)=>a[0].localeCompare(b[0])).map(([key,value])=>({label:key.slice(8)+"/"+key.slice(5,7),value:amount(value)}));
renderBarChart("reportRevenueChart",data,"Nenhuma venda registrada.");
}else{
renderBarChart("reportRevenueChart",dailyRevenue(Number(period),sales),"Nenhuma venda no período.");
}
const ranking=new Map();
for(const s of sales)for(const i of s.items){
const previous=ranking.get(i.productId)||{name:i.name,quantity:0};
previous.quantity+=i.quantity;
ranking.set(i.productId,previous);
}
const top=[...ranking.values()].sort((a,b)=>b.quantity-a.quantity).slice(0,5);
$("topProducts").innerHTML=top.length?top.map((p,i)=>`<div class="top-product"><span class="top-product-rank">${i+1}</span><div class="top-product-info"><strong>${escapeHTML(p.name)}</strong><small>Quantidade vendida</small></div><span class="top-product-quantity">${number(p.quantity)} un.</span></div>`).join(""):'<p class="empty-message">Nenhum produto vendido no período.</p>';
}

function exportBackup(){
const data=JSON.stringify(state,null,2);
const blob=new Blob([data],{type:"application/json"});
const url=URL.createObjectURL(blob);
const link=document.createElement("a");
link.href=url;
link.download=`stockflow-backup-${dayKey(new Date())}.json`;
document.body.appendChild(link);
link.click();
link.remove();
setTimeout(()=>URL.revokeObjectURL(url),1000);
toast("Backup exportado com sucesso.");
}

async function importBackup(file){
if(!file)return;
if(file.size>15*1024*1024){toast("O arquivo excede o limite de 15 MB.",true);return;}
let parsed;
try{
parsed=JSON.parse(await file.text());
validateState(parsed);
}catch(error){
toast(`Backup inválido: ${error.message}`,true);
return;
}
confirmAction("Importar este backup? Todos os dados atuais serão substituídos.",()=>{
if(saveState(parsed)){
cart=[];
renderAll();
toast("Backup importado com sucesso.");
}
});
}

function renderAll(){
renderProducts();
renderInventory();
renderSales();
renderHistory();
renderDashboard();
renderReports();
}

function bindEvents(){
document.querySelectorAll("[data-page]").forEach(button=>button.addEventListener("click",event=>{
event.preventDefault();
navigate(button.dataset.page);
}));
$("openSidebar").addEventListener("click",()=>{
$("sidebar").classList.add("open");
$("sidebarOverlay").classList.add("active");
});
const closeSidebar=()=>{
$("sidebar").classList.remove("open");
$("sidebarOverlay").classList.remove("active");
};
$("closeSidebar").addEventListener("click",closeSidebar);
$("sidebarOverlay").addEventListener("click",closeSidebar);
$("dashboardNewSale").addEventListener("click",()=>navigate("sales"));
$("newProductButton").addEventListener("click",()=>openProduct());
$("productForm").addEventListener("submit",saveProduct);
$("newMovementButton").addEventListener("click",()=>openMovement());
$("movementType").addEventListener("change",updateMovementHelp);
$("movementForm").addEventListener("submit",saveMovement);
$("productSearch").addEventListener("input",renderProducts);
$("productCategoryFilter").addEventListener("change",renderProducts);
$("inventorySearch").addEventListener("input",renderInventory);
$("inventoryStatusFilter").addEventListener("change",renderInventory);
$("saleProductSearch").addEventListener("input",renderSales);
$("salesSearch").addEventListener("input",renderHistory);
$("salesStartDate").addEventListener("change",renderHistory);
$("salesEndDate").addEventListener("change",renderHistory);
$("clearSalesFilters").addEventListener("click",()=>{
$("salesSearch").value="";
$("salesStartDate").value="";
$("salesEndDate").value="";
renderHistory();
});
$("reportPeriod").addEventListener("change",renderReports);
$("finishSaleButton").addEventListener("click",finishSale);
$("clearCartButton").addEventListener("click",()=>{
if(!cart.length)return;
confirmAction("Deseja remover todos os itens do carrinho?",()=>{
cart=[];
renderSales();
toast("Carrinho limpo.");
});
});
$("exportBackupButton").addEventListener("click",exportBackup);
$("importBackupButton").addEventListener("click",()=>$("backupFileInput").click());
$("backupFileInput").addEventListener("change",async event=>{
const file=event.target.files[0];
event.target.value="";
await importBackup(file);
});
document.querySelectorAll("[data-close]").forEach(button=>button.addEventListener("click",()=>closeModal(button.dataset.close)));
document.querySelectorAll(".modal-backdrop").forEach(backdrop=>backdrop.addEventListener("click",event=>{
if(event.target===backdrop)closeModal(backdrop.id);
}));
$("confirmActionButton").addEventListener("click",()=>{
const callback=confirmCallback;
closeModal("confirmModal");
if(callback)callback();
});
document.addEventListener("keydown",event=>{
if(event.key==="Escape"){
const modal=document.querySelector(".modal-backdrop:not(.hidden)");
if(modal)closeModal(modal.id);
else closeSidebar();
}
});
document.addEventListener("click",event=>{
const button=event.target.closest("[data-action]");
if(!button)return;
const {action,id}=button.dataset;
switch(action){
case "edit-product":openProduct(id);break;
case "delete-product":deleteProduct(id);break;
case "move-product":openMovement(id);break;
case "add-cart":addToCart(id);break;
case "increase-cart":changeCartQuantity(id,1);break;
case "decrease-cart":changeCartQuantity(id,-1);break;
case "remove-cart":cart=cart.filter(i=>i.productId!==id);renderSales();break;
case "sale-details":showSaleDetails(id);break;
}
});
}

function init(){
$("currentDate").textContent=new Date().toLocaleDateString("pt-BR",{weekday:"long",day:"numeric",month:"long",year:"numeric"});
bindEvents();
loadState();
renderAll();
}

document.addEventListener("DOMContentLoaded",init);
