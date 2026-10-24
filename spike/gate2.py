import pandas as pd, numpy as np
df=pd.read_csv('daily.csv',index_col=0,parse_dates=True)
d=pd.read_csv('CBP20_H.csv'); d['t']=pd.to_datetime(d['DATE TIME'],format='%Y%m%d %H%M'); d['v']=pd.to_numeric(d['VALUE'],errors='coerce')
s=d.set_index('t')['v']; c=s.resample('D').count(); cbp=s.resample('D').mean(); cbp[c<20]=np.nan
df['CBP']=cbp
print('CBP days>5cfs:',(df.CBP>5).sum(), 'years',sorted(set(df.index[df.CBP>5].year)))
df['R2A_adj']=df.SJB+df.CBP.fillna(0)-df.GRF.shift(1)
x=df[(df.GRF.shift(1)>=50)][['R2A','R2A_adj','GRF','SJB','CBP']].dropna(subset=['R2A'])
flood=x[x.CBP>5]
print('flood days (CBP>5):',len(flood),' R2A raw med',flood.R2A.median().round(0),' adj med',flood.R2A_adj.median().round(0))
st=df[(df.CBP.fillna(0)<=5)&(df.GRF<1600)&(df.GRF.shift(1)<1600)].copy()
st=st['2016-01-01':]
r=st['R2A'].dropna(); r=r[(st.GRF.shift(1)>=50).reindex(r.index).fillna(False)]
print('R2A steady-regime days 2016+:',len(r),' loss median',r.median().round(1),' IQR',r.quantile(.25).round(1),r.quantile(.75).round(1))
# persistence MAE by horizon on test years 2024-2026 (contiguous daily series)
full=st['R2A'].asfreq('D')
for h in [1,3,7]:
    e=(full.shift(-h)-full).abs()
    t=e['2024-01-01':].dropna()
    print(f'persistence MAE h={h} (2024+):',round(t.mean(),1),'cfs; n=',len(t),' vs median |loss|',round(full['2024-01-01':].abs().median(),1))
# ramp events on GRF: 7-day change
g=df.GRF.asfreq('D')
chg=(g/g.shift(7))
ramp=((chg>1.5)&(g>=100))|((chg<0.67)&(g.shift(7)>=100))
resume=(g>=50)&(g.shift(1).rolling(14).max()<20)
for y in range(2016,2027):
    print(y,'ramp days',int(ramp[str(y)].sum()),' resume events',int(resume[str(y)].sum()))
