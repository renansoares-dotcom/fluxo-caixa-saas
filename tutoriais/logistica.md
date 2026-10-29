---
titulo: Logística — cargas, entregas e frota
tela: Logística › Cargas e entregas e Frota e parâmetros
versao: 1.0
atualizado: 2026-10-28
---
## 1. Para que serve

- **Cargas e entregas**: lista as **notas de venda que a frota da IPLAMM entrega**. Com elas, a tela:
  - **monta as cargas** sozinha, pelo peso, pelo volume, pela região e pela jornada do motorista;
  - deixa ajustar arrastando as entregas entre os caminhões;
  - gera o **romaneio** e mostra o **mapa**;
  - registra se cada entrega foi feita.
- **Frota e parâmetros**: os veículos (capacidade, baú, custo), os parâmetros da montagem e os clientes com restrição de entrega.

Os fretes contratados de terceiros (CIOT, MDF-e, piso) ficam em **Logística › Fretes e CIOT**, que tem manual próprio.

## 2. Quem tem acesso

| Perfil | O que faz |
|---|---|
| Administrador, financeiro e diretor | Montam e salvam cargas, dão baixa nas entregas, cadastram veículos e parâmetros. |
| Demais perfis com a área Logística | Consultam. |

## 3. Frota e parâmetros (comece por aqui)

### 3.1 Veículos

Clique em **Incluir veículo** e preencha:

- o código e a placa;
- o tipo;
- a **carga máxima (kg)** e o baú (m³);
- a **ocupação máxima**;
- se é **pequeno**;
- o motorista e a situação: disponível, em manutenção ou inativo.

"Pequeno" é o veículo que pode atender cliente que só recebe veículo pequeno ou que fica num centro com restrição. VUC, 3/4 e utilitário já contam como pequenos. Sem as medidas do baú, só o peso limita a carga.

Para tirar um veículo de uso, prefira marcar **Inativo** a excluir.

### 3.2 Parâmetros da montagem

- **Município de saída** (código IBGE). Vazio = o município do emitente das notas.
- **Fator rodoviário**: a distância em linha reta × o fator dá a estrada aproximada. O usual é 1,3.
- **Velocidade média**, **minutos por entrega** e **jornada máxima** (horas).
- **Diesel (R$/l)**: usado quando o veículo não tem custo por km.
- **m³ por tonelada**: o volume estimado do produto embalado. Ajuste depois de medir.
- **Raio máximo da frota (km)**: acima disso, a entrega aparece como "transportadora?".
- **Dias para considerar atrasada**.
- **Notas que a frota entrega**, pela modalidade de frete da NF-e: 0 (por conta do emitente, CIF), 1 (por conta do destinatário, FOB), 2 (de terceiros) e 9 (sem frete).

Clique em **Salvar parâmetros**.

### 3.3 Clientes com restrição

Clique em **Incluir cliente** e informe o CNPJ/CPF, se ele **só recebe veículo pequeno**, os dias e o horário de recebimento e uma observação.

## 4. Cargas e entregas

### 4.1 Montar as cargas do dia

1. Escolha o **dia das cargas** e o período das notas (**Notas de / até**).
2. Em **Pendentes de carga** estão as notas ainda não entregues.
3. Clique em **Montar cargas automaticamente**. A plataforma distribui as entregas pelos veículos livres, respeitando o peso, o volume, a região, a jornada e as restrições dos clientes. A linha tracejada no mapa indica que a sugestão ainda não foi salva.
4. Ajuste arrastando as entregas entre os caminhões, ou use **+ carga** na entrega pendente. **Nova carga** cria uma carga vazia.
5. Clique em **Salvar cargas**, ou em **Descartar** para jogar a sugestão fora.

**Ver no mapa** mostra os pontos no centro de cada município e o trajeto. As distâncias são estimadas.

### 4.2 Romaneio

Na carga, clique em **Romaneio**. Ele sai no padrão IPLAMM, com:

- os dados da carga;
- a **ordem de carregamento**, em que a última entrega entra primeiro;
- a **ordem de entrega**, com espaço para "recebido por / assinatura".

### 4.3 Dar baixa nas entregas

Quando o caminhão voltar, abra a carga e marque cada entrega como **Entregue** ou **Não entregue**. Para fechar de uma vez, escolha **Todas entregues**, ou **Não entregues** (elas voltam para as pendentes), e clique em **Dar baixa**.

### 4.4 Baixa inicial

Para as notas que foram entregues **antes** de usar a plataforma, use **Baixa inicial…**: informe até que data as notas emitidas já foram entregues. Elas saem das pendentes. A baixa inicial pode ser desfeita no mesmo dia.

## 5. Regras e travas

- Carga que já saiu não pode perder entregas.
- Excluir ou cancelar uma carga devolve as notas para as pendentes.
- A plataforma avisa quando um cliente que só recebe veículo pequeno vai num veículo que não é pequeno.
- O ponto de saída precisa estar definido nos parâmetros.

## 6. Perguntas frequentes e erros comuns

**A mensagem diz "Nada coube nos veículos livres".** Confira a carga máxima, o baú e a jornada dos veículos, e se eles estão como "Disponível".

**A mensagem diz "Defina o ponto de saída em Frota e parâmetros".** Preencha o município de saída (código IBGE) nos parâmetros.

**Uma nota não aparece nas pendentes.** A modalidade de frete da nota não está entre as que a frota entrega, ou a nota ainda não foi importada em Notas Fiscais.

## 7. Histórico de alterações

| Versão | Data | O que mudou |
|---|---|---|
| 1.0 | 28/10/2026 | Primeira versão do manual: frota, parâmetros, clientes com restrição, montagem automática de cargas, romaneio, mapa, baixa das entregas e baixa inicial. |
